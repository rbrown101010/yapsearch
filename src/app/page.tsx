'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import remarkGfm from 'remark-gfm';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  searchResults?: SearchResult[];
  fullTavilyData?: TavilyResponse;
  reasoningInput?: string;
}

interface TavilyImage {
  url: string;
  description?: string;
}

interface SearchResult {
  title: string;
  content: string;
  url: string;
  snippet?: string;
  score?: number;
  image?: TavilyImage;
}

interface TavilyResponse {
  results: SearchResult[];
  images?: TavilyImage[];
  answer?: string;
  query?: string;
}

interface ChatSection {
  query: string;
  searchResults: SearchResult[];
  reasoning: string;
  response: string;
  error?: string | null;
  isLoadingSources?: boolean;
  isLoadingThinking?: boolean;
  isReasoningCollapsed?: boolean;
}

interface SuggestionType {
  label: string;
  prefix: string;
}

// Add TopBar component
const TopBar = () => {
  return (
    <div className="fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center px-6 z-50">
      <h1 className="text-2xl font-serif text-gray-900 tracking-tight">YapSearch</h1>
    </div>
  );
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentReasoning, setCurrentReasoning] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [currentSearchResults, setCurrentSearchResults] = useState<SearchResult[]>([]);
  const [showTavilyModal, setShowTavilyModal] = useState(false);
  const [showReasoningModal, setShowReasoningModal] = useState(false);
  const [selectedMessageData, setSelectedMessageData] = useState<{tavily?: TavilyResponse, reasoning?: string}>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [chatSections, setChatSections] = useState<ChatSection[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<string | null>(null);
  
  const suggestions: SuggestionType[] = [
    { label: "Podcast Outline", prefix: "Create a detailed podcast outline for: " },
    { label: "YouTube Video Research", prefix: "Research and outline a YouTube video about: " },
    { label: "Short Form Hook Ideas", prefix: "Generate engaging hook ideas for short-form content about: " },
    { label: "Newsletter Draft", prefix: "Write a newsletter draft about: " }
  ];

  const handleSuggestionClick = (suggestion: SuggestionType) => {
    setSelectedSuggestion(suggestion.label);
    if (input) {
      setInput(suggestion.prefix + input);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setHasSubmitted(true);
    setLastQuery(input);
    setError(null);
    setCurrentSearchResults([]);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const userMessage = { role: 'user' as const, content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setCurrentReasoning('');

    // Create a new chat section with loading states
    const newSection: ChatSection = {
      query: input,
      searchResults: [],
      reasoning: '',
      response: '',
      error: null,
      isLoadingSources: true,
      isLoadingThinking: false
    };
    setChatSections(prev => [...prev, newSection]);
    const sectionIndex = chatSections.length;

    try {
      // Step 1: Search with Tavily
      const searchResponse = await fetch('/api/tavily', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: input,
          includeImages: true,
          includeImageDescriptions: true
        }),
        signal: abortControllerRef.current.signal,
      });

      const searchData = await searchResponse.json();
      
      if (!searchResponse.ok) {
        throw new Error(searchData.error || 'Failed to fetch search results');
      }

      if (!searchData.results || searchData.results.length === 0) {
        throw new Error('No relevant search results found. Please try a different query.');
      }

      // Combine images with results
      const resultsWithImages = searchData.results.map((result: SearchResult, index: number) => ({
        ...result,
        image: searchData.images?.[index]
      }));

      // Update section with search results and start thinking
      setChatSections(prev => {
        const updated = [...prev];
        updated[sectionIndex] = {
          ...updated[sectionIndex],
          searchResults: resultsWithImages,
          isLoadingSources: false,
          isLoadingThinking: true
        };
        return updated;
      });

      // Step 2: Format search results for DeepSeek
      const searchContext = resultsWithImages
        .map((result: SearchResult, index: number) => 
          `[Source ${index + 1}]: ${result.title}\n${result.content}\nURL: ${result.url}\n`
        )
        .join('\n\n');

      const tavilyAnswer = searchData.answer 
        ? `\nTavily's Direct Answer: ${searchData.answer}\n\n` 
        : '';

      // Add sources table at the end
      const sourcesTable = `\n\n## Sources\n| Number | Source | Description |\n|---------|---------|-------------|\n` +
        resultsWithImages.map((result: SearchResult, index: number) => 
          `| ${index + 1} | [${result.title}](${result.url}) | ${result.snippet || result.content.slice(0, 150)}${result.content.length > 150 ? '...' : ''} |`
        ).join('\n');

      const reasoningInput = `Here is the research data:${tavilyAnswer}\n${searchContext}\n\nPlease analyze this information and create a detailed report addressing the original query: "${input}". Include citations to the sources where appropriate. If the sources contain any potential biases or conflicting information, please note that in your analysis.\n\nIMPORTANT: Always end your response with a sources table listing all references used. Format it exactly as shown below:\n${sourcesTable}`;

      let assistantMessage: Message = {
        role: 'assistant',
        content: '',
        reasoning: '',
        searchResults: resultsWithImages,
        fullTavilyData: searchData,
        reasoningInput
      };

      // Step 3: Get analysis from DeepSeek
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [
          userMessage,
          {
            role: 'assistant' as const,
            content: 'I found some relevant information. Let me analyze it and create a comprehensive report.',
          },
          {
            role: 'user' as const,
            content: reasoningInput,
          },
        ] }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to generate report. Please try again.');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader available');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.choices?.[0]?.delta?.reasoning_content) {
              const newReasoning = (assistantMessage.reasoning || '') + parsed.choices[0].delta.reasoning_content;
              assistantMessage.reasoning = newReasoning;
              setCurrentReasoning(newReasoning);
              setChatSections(prev => {
                const updated = [...prev];
                updated[sectionIndex] = {
                  ...updated[sectionIndex],
                  reasoning: newReasoning,
                  isLoadingThinking: false
                };
                return updated;
              });
            } else if (parsed.choices?.[0]?.delta?.content) {
              const newContent = (assistantMessage.content || '') + parsed.choices[0].delta.content;
              assistantMessage.content = newContent;
              setChatSections(prev => {
                const updated = [...prev];
                updated[sectionIndex] = {
                  ...updated[sectionIndex],
                  response: newContent
                };
                return updated;
              });
            }
          } catch (e) {
            console.error('Error parsing chunk:', e);
          }
        }
      }

      // Update the section with search results
      setChatSections(prev => {
        const updated = [...prev];
        updated[sectionIndex] = {
          ...updated[sectionIndex],
          searchResults: resultsWithImages
        };
        return updated;
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request was aborted');
      } else {
        const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
        console.error('Error:', error);
        setError(errorMessage);
        setChatSections(prev => {
          const updated = [...prev];
          updated[sectionIndex] = {
            ...updated[sectionIndex],
            error: errorMessage,
            isLoadingSources: false,
            isLoadingThinking: false
          };
          return updated;
        });
      }
    } finally {
      setIsLoading(false);
      setSearchStatus('');
      abortControllerRef.current = null;
    }
  };

  const toggleReasoning = (index: number) => {
    setChatSections(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        isReasoningCollapsed: !updated[index].isReasoningCollapsed
      };
      return updated;
    });
  };

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <div className="pt-14 pb-24"> {/* Add padding top to account for fixed header */}
        <main className="max-w-3xl mx-auto p-8">
          <AnimatePresence>
            {!hasSubmitted ? (
              <motion.div 
                className="min-h-screen flex flex-col items-center justify-center"
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, y: -50 }}
                transition={{ duration: 0.3 }}
              >
                <div className="text-center mb-12">
                  <div className="inline-block px-4 py-1.5 bg-gray-900 text-white rounded-full text-sm font-medium mb-6">
                    Powered by YapThread
                  </div>
                  <h1 className="text-5xl font-serif text-gray-900 mb-4 tracking-tight">Your AI Powered Content Research Assistant</h1>
                  <p className="text-xl text-gray-600 font-light max-w-2xl mx-auto leading-relaxed">
                    Do research for content in seconds, so you can spend more time going viral.
                  </p>
                </div>
                <form onSubmit={handleSubmit} className="w-full max-w-[704px] mx-4">
                  <div className="relative bg-gray-50 rounded-xl shadow-md border border-gray-300">
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask a question..."
                      className="w-full p-5 pr-32 rounded-xl border-2 border-transparent focus:border-gray-900 focus:shadow-lg focus:outline-none resize-none h-[92px] bg-gray-50 transition-all duration-200"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e);
                        }
                      }}
                    />
                    <div className="absolute right-3 bottom-3 flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium relative overflow-hidden group"
                      >
                        <span className="relative z-10">{isLoading ? 'Thinking...' : 'Send'}</span>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-white/15 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                      </button>
                    </div>
                  </div>
                  
                  {/* Suggestions */}
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        onClick={() => handleSuggestionClick(suggestion)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          selectedSuggestion === suggestion.label
                            ? 'bg-gray-900 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                </form>
              </motion.div>
            ) : (
              <motion.div 
                className="space-y-6 pb-32"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                {chatSections.map((section, index) => (
                  <div key={index} className="pt-8 border-b border-gray-200 last:border-0">
                    {/* Query */}
                    <div className="mb-8">
                      <p className="text-lg text-gray-800">
                        {section.query}
                      </p>
                    </div>

                    {/* Loading States */}
                    {isLoading && (
                      <div className="mb-6 flex items-center gap-8 text-sm text-gray-500">
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-2"
                        >
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                          <span>Loading Sources</span>
                        </motion.div>

                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 2 }}
                          className="flex items-center gap-2"
                        >
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                          <span>Reading Content</span>
                        </motion.div>

                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 4 }}
                          className="flex items-center gap-2"
                        >
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                          <span>Analyzing Data</span>
                        </motion.div>
                      </div>
                    )}

                    {/* Sources Loading State */}
                    {section.isLoadingSources && (
                      <div className="mb-12 animate-pulse">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-5 h-5 bg-gray-200 rounded" />
                          <div className="h-4 w-20 bg-gray-200 rounded" />
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-4">
                          {[1, 2, 3].map((_, idx) => (
                            <div key={idx} className="flex-shrink-0 w-[300px] bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
                              <div className="h-40 bg-gray-200 animate-pulse flex items-center justify-center">
                                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <div className="p-4 space-y-3">
                                <div className="h-4 bg-gray-200 rounded w-3/4" />
                                <div className="h-4 bg-gray-200 rounded w-full" />
                                <div className="h-4 bg-gray-200 rounded w-2/3" />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Search Results */}
                    {section.searchResults.length > 0 && (
                      <div className="mb-12">
                        <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9.5a2.5 2.5 0 00-2.5-2.5H14" />
                            </svg>
                            <h3 className="text-sm font-semibold text-gray-600">Sources</h3>
                          </div>
                          <button
                            onClick={() => {
                              setSelectedMessageData({ tavily: messages[messages.length - 1]?.fullTavilyData });
                              setShowTavilyModal(true);
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                          >
                            <span>View Full Data</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          </button>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
                          {section.searchResults.map((result, idx) => (
                            <div 
                              key={idx}
                              className="flex-shrink-0 w-[300px] bg-gray-50 border border-gray-200 rounded-xl overflow-hidden"
                            >
                              <div className="h-40 bg-gray-200 overflow-hidden relative">
                                {result.image ? (
                                  <>
                                    <div className="absolute inset-0 bg-gray-200 animate-pulse" />
                                    <img 
                                      src={result.image.url} 
                                      alt={result.image.description || result.title}
                                      className="w-full h-full object-cover relative z-10"
                                      onLoad={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.style.opacity = '1';
                                      }}
                                      style={{ opacity: 0, transition: 'opacity 0.3s' }}
                                    />
                                  </>
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                              <div className="p-4">
                                <a 
                                  href={result.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-blue-600 hover:underline block mb-2 font-medium line-clamp-2"
                                >
                                  {result.title}
                                </a>
                                <p className="text-sm text-gray-600 line-clamp-3">{result.content}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Thinking Process Loading State */}
                    {section.isLoadingThinking && (
                      <div className="mb-12">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-5 h-5 bg-gray-200 rounded" />
                          <div className="h-4 w-32 bg-gray-200 rounded" />
                        </div>
                        <div className="pl-4 border-l-2 border-gray-300">
                          <div className="animate-pulse space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-full" />
                            <div className="h-4 bg-gray-200 rounded w-5/6" />
                            <div className="h-4 bg-gray-200 rounded w-4/5" />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Thinking Process */}
                    {section.reasoning && (
                      <div className="mb-12">
                        <div className="flex justify-between items-center mb-4">
                          <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            <h3 className="text-sm font-semibold text-gray-600">Thinking Process:</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setSelectedMessageData({ reasoning: messages[messages.length - 1]?.reasoningInput });
                                setShowReasoningModal(true);
                              }}
                              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                            >
                              <span>View Full Input</span>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            </button>
                            <button
                              onClick={() => toggleReasoning(index)}
                              className="text-gray-600 hover:text-gray-700"
                            >
                              <svg 
                                className={`w-5 h-5 transform transition-transform ${section.isReasoningCollapsed ? '-rotate-90' : 'rotate-0'}`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        <motion.div 
                          className="pl-4 border-l-2 border-gray-300"
                          initial={false}
                          animate={{ 
                            height: section.isReasoningCollapsed ? 0 : 'auto',
                            opacity: section.isReasoningCollapsed ? 0 : 1
                          }}
                          transition={{ duration: 0.3 }}
                        >
                          <div className="text-sm text-gray-600 leading-relaxed overflow-hidden">
                            {section.reasoning}
                          </div>
                        </motion.div>
                      </div>
                    )}

                    {/* Final Report */}
                    {section.response && (
                      <div className="mt-12 mb-16">
                        <div className="prose prose-blue max-w-none space-y-4 text-gray-800 [&>ul]:list-disc [&>ul]:pl-6 [&>ol]:list-decimal [&>ol]:pl-6">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              table: ({ node, ...props }) => (
                                <div className="my-8 overflow-x-auto rounded-lg border border-gray-200">
                                  <table className="w-full text-left border-collapse" {...props} />
                                </div>
                              ),
                              thead: ({ node, ...props }) => (
                                <thead className="bg-gray-50" {...props} />
                              ),
                              tbody: ({ node, ...props }) => (
                                <tbody className="bg-white divide-y divide-gray-200" {...props} />
                              ),
                              tr: ({ node, ...props }) => (
                                <tr 
                                  className="hover:bg-gray-50 transition-colors" 
                                  {...props} 
                                />
                              ),
                              th: ({ node, ...props }) => (
                                <th 
                                  className="py-3 px-4 font-medium text-sm text-gray-900 border-b border-gray-200" 
                                  {...props} 
                                />
                              ),
                              td: ({ node, ...props }) => {
                                // Check if the content includes a markdown link
                                const content = props.children?.toString() || '';
                                if (content.match(/\[.*?\]\(.*?\)/)) {
                                  return (
                                    <td className="py-3 px-4 text-sm text-gray-500">
                                      <ReactMarkdown
                                        components={{
                                          a: ({ node, ...linkProps }) => (
                                            <a {...linkProps} className="text-blue-600 hover:text-blue-800 hover:underline" target="_blank" rel="noopener noreferrer" />
                                          )
                                        }}
                                      >
                                        {content}
                                      </ReactMarkdown>
                                    </td>
                                  );
                                }
                                return (
                                  <td 
                                    className="py-3 px-4 text-sm text-gray-500" 
                                    {...props} 
                                  />
                                );
                              },
                              pre: ({ node, children, ...props }) => {
                                const content = String(children);
                                if (content.includes('|') && content.includes('\n')) {
                                  const rows = content.trim().split('\n');
                                  const headers = rows[0].split('|').filter(Boolean).map(h => h.trim());
                                  const data = rows.slice(2).map(row => 
                                    row.split('|').filter(Boolean).map(cell => cell.trim())
                                  );

                                  return (
                                    <div className="my-8 overflow-x-auto">
                                      <table className="w-full text-left border-collapse border border-gray-200">
                                        <thead className="bg-gray-50">
                                          <tr>
                                            {headers.map((header, i) => (
                                              <th key={i} className="py-3 px-4 font-medium text-sm text-gray-900 border-b border-gray-200">
                                                {header}
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody className="bg-white">
                                          {data.map((row, i) => (
                                            <tr key={i} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                                              {row.map((cell, j) => (
                                                <td key={j} className="py-3 px-4 text-sm text-gray-500">
                                                  {cell}
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                }
                                return <pre {...props}>{children}</pre>;
                              },
                              a: ({ node, ...props }) => {
                                const href = props.href || '';
                                const sourceMatch = href.match(/\[Source (\d+)\]/);
                                if (sourceMatch) {
                                  const sourceIndex = parseInt(sourceMatch[1]) - 1;
                                  const source = section.searchResults[sourceIndex];
                                  return (
                                    <span className="inline-flex items-center group relative">
                                      <a {...props} className="inline-flex items-center text-blue-600 hover:text-blue-800">
                                        <svg className="w-4 h-4 mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                        </svg>
                                        {props.children}
                                      </a>
                                      {source && (
                                        <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50">
                                          <div className="bg-white p-4 rounded-lg shadow-lg border border-gray-200 w-80">
                                            <h4 className="font-medium text-gray-900 mb-2">{source.title}</h4>
                                            <p className="text-sm text-gray-600 mb-2">{source.content}</p>
                                            <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                              Visit source →
                                            </a>
                                          </div>
                                        </div>
                                      )}
                                    </span>
                                  );
                                }
                                return <a {...props} className="text-blue-600 hover:text-blue-800" />;
                              }
                            }}
                          >
                            {section.response}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {section.error && (
                      <div className="text-center text-red-600 mb-8">
                        {section.error}
                      </div>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Updated floating input box styling - show immediately after first submission */}
      {hasSubmitted && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center">
          <form onSubmit={handleSubmit} className="w-full max-w-[704px] mx-4">
            <div className="relative bg-gray-50 rounded-xl shadow-md border border-gray-300">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                className="w-full p-5 pr-32 rounded-xl border-2 border-transparent focus:border-gray-900 focus:shadow-lg focus:outline-none resize-none h-[92px] bg-gray-50 transition-all duration-200"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
              />
              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium relative overflow-hidden group"
                >
                  <span className="relative z-10">{isLoading ? 'Thinking...' : 'Send'}</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-white/15 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Modal for Tavily Data */}
      {showTavilyModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Full Tavily Response</h3>
              <button
                onClick={() => setShowTavilyModal(false)}
                className="text-gray-600 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-gray-600 font-mono">
              {JSON.stringify(selectedMessageData?.tavily, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Modal for Reasoning Input */}
      {showReasoningModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Full Reasoning Input</h3>
              <button
                onClick={() => setShowReasoningModal(false)}
                className="text-gray-600 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-gray-600 font-mono">
              {selectedMessageData?.reasoning}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
