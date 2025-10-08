import React, { useState, useCallback, useRef, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Settings, RotateCcw } from 'lucide-react';
import svgPaths from "./imports/svg-n6u0l8qsx1";

// Default writing blocks (empty - users start by generating their own)
const DEFAULT_WRITING_BLOCKS = [];

// Helper function to repair malformed JSON
function repairJSON(jsonStr) {
  try {
    // First, try to parse as-is
    return JSON.parse(jsonStr);
  } catch (error) {
    console.log('Initial JSON parse failed, attempting repair...');
    
    let repaired = jsonStr.trim();
    
    // Remove any trailing commas before closing brackets
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    
    // If the JSON starts with [ but doesn't end with ], try to complete it
    if (repaired.startsWith('[') && !repaired.endsWith(']')) {
      // Find the last complete object
      let braceCount = 0;
      let lastCompleteObjectEnd = -1;
      
      for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            lastCompleteObjectEnd = i;
          }
        }
      }
      
      if (lastCompleteObjectEnd > -1) {
        // Trim to the last complete object and close the array
        repaired = repaired.substring(0, lastCompleteObjectEnd + 1) + ']';
      } else {
        // If no complete objects found, try to close the array anyway
        repaired = repaired + '}]';
      }
    }
    
    // Try parsing the repaired JSON
    try {
      return JSON.parse(repaired);
    } catch (repairError) {
      console.log('JSON repair failed, attempting manual extraction...');
      
      // Last resort: try to extract individual objects manually
      const objects = [];
      const objectRegex = /\{[^{}]*"title"\s*:\s*"[^"]*"[^{}]*"summary"\s*:\s*"[^"]*"[^{}]*\}/g;
      let match;
      
      while ((match = objectRegex.exec(repaired)) !== null) {
        try {
          const obj = JSON.parse(match[0]);
          if (obj.title && obj.summary) {
            objects.push(obj);
          }
        } catch (objError) {
          // Skip invalid objects
          continue;
        }
      }
      
      if (objects.length > 0) {
        console.log(`Extracted ${objects.length} objects manually`);
        return objects;
      }
      
      // If all else fails, throw the original error
      throw error;
    }
  }
}

// Helper function to extract JSON from text
function extractJSON(text) {
  // Remove any markdown code blocks
  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // Try to find JSON array in the text
  const jsonMatch = text.match(/\[\s*{[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  // Look for array start and try to find a reasonable end
  const startIndex = text.indexOf('[');
  if (startIndex !== -1) {
    // Try to find the matching closing bracket
    let endIndex = text.lastIndexOf(']');
    
    if (endIndex !== -1 && endIndex > startIndex) {
      return text.substring(startIndex, endIndex + 1);
    } else {
      // If no closing bracket found, take everything from [ to end and let repair function handle it
      return text.substring(startIndex);
    }
  }
  
  return text.trim();
}

// Generate writing blocks using OpenAI
async function generateBlocksWithOpenAI(topic, existingBlocks = []) {

  const existingTopics = existingBlocks.length > 0 
    ? `\n\nIMPORTANT: Generate DIFFERENT blocks from these existing ones. Avoid these topics:\n${existingBlocks.map(block => `- ${block.title}: ${block.summary}`).join('\n')}\n\nFocus on different aspects, approaches, or sections that complement but don't duplicate the existing blocks.`
    : '';

  const prompt = `You are a professional writing assistant. Generate exactly 8 writing blocks for the topic: "${topic}"

Each block should represent a key section or element that someone writing about this topic should consider including. 

For each block, provide:
1. A short, descriptive title (2-4 words, like a section heading)
2. A one-line explanation of what content this section should include

${existingTopics}

CRITICAL: Respond with ONLY a valid JSON array. No additional text, explanations, or markdown formatting.
CRITICAL: Ensure the JSON is complete and properly closed with ].

Format your response exactly like this:
[
  {
    "title": "Opening greeting",
    "summary": "Start with a warm, professional greeting that sets a positive tone for the conversation."
  },
  {
    "title": "Context setting", 
    "summary": "Provide background information and establish why you're writing this communication."
  }
]

Topic: "${topic}"

Generate exactly 8 blocks with specific, actionable guidance for someone writing about this topic. Focus on logical flow and comprehensive coverage. ENSURE the JSON array is complete and properly formatted.`;

  try {
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: 'gpt-4o',
    //     messages: [
    //       {
    //         role: 'user',
    //         content: prompt
    //       }
    //     ],
    //     max_tokens: 2000, // Reduced since we're generating fewer blocks
    //     temperature: 0.7, // Reduced from 0.8 for more consistent formatting
    //   }),
    // });

    // if (!response.ok) {
    //   if (response.status === 401) {
    //     throw new Error('Invalid OpenAI API key. Please check your API key and try again.');
    //   } else if (response.status === 403) {
    //     throw new Error('Access denied to OpenAI API. Please check your API key permissions and billing status.');
    //   } else if (response.status === 429) {
    //     throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    //   } else if (response.status === 500) {
    //     throw new Error('OpenAI API server error. Please try again later.');
    //   } else {
    //     throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    //   }
    // }

    // const data = await response.json();

    const response = await fetch('/.netlify/functions/chat-completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        prompt: prompt,
        maxTokens: 2000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }

    let content = data.choices[0].message.content.trim();
    console.log('Raw OpenAI response:', content); // Debug logging
    
    // Extract JSON from the response
    content = extractJSON(content);
    console.log('Extracted JSON:', content); // Debug logging
    
    try {
      // Use the repair function instead of direct JSON.parse
      const blocks = repairJSON(content);
      
      if (!Array.isArray(blocks)) {
        throw new Error(`Expected array, got ${typeof blocks}`);
      }
      
      if (blocks.length === 0) {
        throw new Error('Received empty array from OpenAI');
      }
      
      console.log(`Successfully parsed ${blocks.length} blocks from OpenAI`);
      
      // If we got less than 8 blocks, pad with generic ones
      if (blocks.length < 8) {
        console.warn(`Only received ${blocks.length} blocks, padding to 8`);
        for (let i = blocks.length; i < 8; i++) {
          blocks.push({
            title: `Additional point ${i + 1}`,
            summary: `Consider including additional relevant information or details for your ${topic}.`
          });
        }
      }
      
      // Take only the first 8 blocks if we got more
      const finalBlocks = blocks.slice(0, 8);
      
      // Validate and sanitize each block
      return finalBlocks.map((block, index) => {
        if (!block || typeof block !== 'object') {
          console.warn(`Invalid block at index ${index}:`, block);
          return {
            id: index + 1,
            title: `Block ${index + 1}`,
            summary: `Content for block ${index + 1}`,
            source: 'generated'
          };
        }
        
        return {
          id: index + 1,
          title: (block.title || block.summary || `Block ${index + 1}`).toString().slice(0, 50),
          summary: (block.summary || block.description || block.content || 'No description provided').toString(),
          source: 'generated'
        };
      });
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Content that failed to parse:', content);
      
      // Enhanced fallback: try to create blocks from whatever content we have
      const fallbackBlocks = [];
      
      // Try to extract title and summary pairs from the content
      const titleMatches = content.match(/"title"\s*:\s*"([^"]*)"/g);
      const summaryMatches = content.match(/"summary"\s*:\s*"([^"]*)"/g);
      
      if (titleMatches && summaryMatches) {
        const titles = titleMatches.map(m => m.match(/"title"\s*:\s*"([^"]*)"/)[1]);
        const summaries = summaryMatches.map(m => m.match(/"summary"\s*:\s*"([^"]*)"/)[1]);
        
        const maxPairs = Math.min(titles.length, summaries.length, 8);
        for (let i = 0; i < maxPairs; i++) {
          fallbackBlocks.push({
            id: i + 1,
            title: titles[i].slice(0, 50),
            summary: summaries[i],
            source: 'generated'
          });
        }
      }
      
      if (fallbackBlocks.length > 0) {
        console.log(`Extracted ${fallbackBlocks.length} blocks as fallback`);
        
        // Pad to 8 if needed
        while (fallbackBlocks.length < 8) {
          const index = fallbackBlocks.length;
          fallbackBlocks.push({
            id: index + 1,
            title: `Topic point ${index + 1}`,
            summary: `Additional content related to ${topic}.`,
            source: 'generated'
          });
        }
        
        return fallbackBlocks;
      }
      
      throw new Error(`Failed to parse OpenAI response as JSON: ${parseError.message}`);
    }
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Unable to connect to OpenAI API. Please check your internet connection.');
    }
    throw error;
  }
}

// Generate additional blocks using OpenAI
async function generateMoreBlocksWithOpenAI(topic, existingBlocks = []) {

  const existingTopics = existingBlocks.length > 0 
    ? `\n\nIMPORTANT: Generate DIFFERENT blocks from these existing ones. Avoid these topics:\n${existingBlocks.map(block => `- ${block.title}: ${block.summary}`).join('\n')}\n\nFocus on different aspects, approaches, or sections that complement but don't duplicate the existing blocks.`
    : '';

  const prompt = `You are a professional writing assistant. Generate exactly 8 additional writing blocks for the topic: "${topic}"

Each block should represent a key section or element that someone writing about this topic should consider including. 

For each block, provide:
1. A short, descriptive title (2-4 words, like a section heading)
2. A one-line explanation of what content this section should include

${existingTopics}

CRITICAL: Respond with ONLY a valid JSON array. No additional text, explanations, or markdown formatting.
CRITICAL: Ensure the JSON is complete and properly closed with ].

Format your response exactly like this:
[
  {
    "title": "Opening greeting",
    "summary": "Start with a warm, professional greeting that sets a positive tone for the conversation."
  },
  {
    "title": "Context setting", 
    "summary": "Provide background information and establish why you're writing this communication."
  }
]

Topic: "${topic}"

Generate exactly 8 blocks with specific, actionable guidance for someone writing about this topic. Focus on logical flow and comprehensive coverage. ENSURE the JSON array is complete and properly formatted.`;

  try {
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: 'gpt-4o',
    //     messages: [
    //       {
    //         role: 'user',
    //         content: prompt
    //       }
    //     ],
    //     max_tokens: 2000,
    //     temperature: 0.7,
    //   }),
    // });

    // if (!response.ok) {
    //   if (response.status === 401) {
    //     throw new Error('Invalid OpenAI API key. Please check your API key and try again.');
    //   } else if (response.status === 403) {
    //     throw new Error('Access denied to OpenAI API. Please check your API key permissions and billing status.');
    //   } else if (response.status === 429) {
    //     throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    //   } else if (response.status === 500) {
    //     throw new Error('OpenAI API server error. Please try again later.');
    //   } else {
    //     throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    //   }
    // }

    // const data = await response.json();

    const response = await fetch('/.netlify/functions/chat-completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        prompt: prompt,
        maxTokens: 2000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }

    let content = data.choices[0].message.content.trim();
    console.log('Raw OpenAI response:', content); // Debug logging
    
    // Extract JSON from the response
    content = extractJSON(content);
    console.log('Extracted JSON:', content); // Debug logging
    
    try {
      // Use the repair function instead of direct JSON.parse
      const blocks = repairJSON(content);
      
      if (!Array.isArray(blocks)) {
        throw new Error(`Expected array, got ${typeof blocks}`);
      }
      
      if (blocks.length === 0) {
        throw new Error('Received empty array from OpenAI');
      }
      
      console.log(`Successfully parsed ${blocks.length} additional blocks from OpenAI`);
      
      // If we got less than 8 blocks, pad with generic ones
      if (blocks.length < 8) {
        console.warn(`Only received ${blocks.length} blocks, padding to 8`);
        for (let i = blocks.length; i < 8; i++) {
          blocks.push({
            title: `Additional point ${i + 1}`,
            summary: `Consider including additional relevant information or details for your ${topic}.`
          });
        }
      }
      
      // Take only the first 8 blocks if we got more
      const finalBlocks = blocks.slice(0, 8);
      
      // Find the highest existing ID to continue numbering
      const maxId = Math.max(...existingBlocks.map(block => block.id));
      
      // Validate and sanitize each block
      return finalBlocks.map((block, index) => {
        if (!block || typeof block !== 'object') {
          console.warn(`Invalid block at index ${index}:`, block);
          return {
            id: maxId + index + 1,
            title: `Block ${maxId + index + 1}`,
            summary: `Content for block ${maxId + index + 1}`,
            source: 'generated'
          };
        }
        
        return {
          id: maxId + index + 1,
          title: (block.title || block.summary || `Block ${maxId + index + 1}`).toString().slice(0, 50),
          summary: (block.summary || block.description || block.content || 'No description provided').toString(),
          source: 'generated'
        };
      });
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Content that failed to parse:', content);
      
      // Enhanced fallback: try to create blocks from whatever content we have
      const fallbackBlocks = [];
      
      // Try to extract title and summary pairs from the content
      const titleMatches = content.match(/"title"\s*:\s*"([^"]*)"/g);
      const summaryMatches = content.match(/"summary"\s*:\s*"([^"]*)"/g);
      
      if (titleMatches && summaryMatches) {
        const titles = titleMatches.map(m => m.match(/"title"\s*:\s*"([^"]*)"/)[1]);
        const summaries = summaryMatches.map(m => m.match(/"summary"\s*:\s*"([^"]*)"/)[1]);
        
        const maxPairs = Math.min(titles.length, summaries.length, 8);
        const maxId = Math.max(...existingBlocks.map(block => block.id));
        
        for (let i = 0; i < maxPairs; i++) {
          fallbackBlocks.push({
            id: maxId + i + 1,
            title: titles[i].slice(0, 50),
            summary: summaries[i],
            source: 'generated'
          });
        }
      }
      
      if (fallbackBlocks.length > 0) {
        console.log(`Extracted ${fallbackBlocks.length} additional blocks as fallback`);
        
        // Pad to 8 if needed
        const maxId = Math.max(...existingBlocks.map(block => block.id));
        while (fallbackBlocks.length < 8) {
          const index = fallbackBlocks.length;
          fallbackBlocks.push({
            id: maxId + index + 1,
            title: `Topic point ${maxId + index + 1}`,
            summary: `Additional content related to ${topic}.`,
            source: 'generated'
          });
        }
        
        return fallbackBlocks;
      }
      
      throw new Error(`Failed to parse OpenAI response as JSON: ${parseError.message}`);
    }
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Unable to connect to OpenAI API. Please check your internet connection.');
    }
    throw error;
  }
}

// Generate title using OpenAI
async function generateTitleWithOpenAI(text) {

  const prompt = `You are a professional writing assistant. Your task is to create a concise, descriptive title for the following text content. The title should:

1. Be 2-4 words maximum
2. Capture the main topic or theme
3. Use title case (capitalize each word)
4. Be clear and specific
5. Work as a section heading

Text content: "${text}"

Respond with ONLY the title. No quotes, no additional text, no explanations.`;

  try {
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: 'gpt-4o-mini',
    //     messages: [
    //       {
    //         role: 'user',
    //         content: prompt
    //       }
    //     ],
    //     max_tokens: 20, // Keep it short for titles
    //     temperature: 0.3, // Lower temperature for more consistent titles
    //   }),
    // });

    // if (!response.ok) {
    //   if (response.status === 401) {
    //     throw new Error('Invalid OpenAI API key. Please check your API key and try again.');
    //   } else if (response.status === 403) {
    //     throw new Error('Access denied to OpenAI API. Please check your API key permissions and billing status.');
    //   } else if (response.status === 429) {
    //     throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    //   } else if (response.status === 500) {
    //     throw new Error('OpenAI API server error. Please try again later.');
    //   } else {
    //     throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    //   }
    // }

    // const data = await response.json();

    const response = await fetch('/.netlify/functions/chat-completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        prompt: prompt,
        maxTokens: 20,
        temperature: 0.3
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }

    let title = data.choices[0].message.content.trim();
    
    // Remove any quotes if present
    title = title.replace(/^["']|["']$/g, '');
    
    // Ensure it's not too long (fallback)
    if (title.length > 50) {
      title = title.slice(0, 47) + '...';
    }
    
    return title || 'Custom Block';
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Unable to connect to OpenAI API. Please check your internet connection.');
    }
    throw error;
  }
}



// Test OpenAI connection
async function testOpenAIConnection() {

  try {
    // const response = await fetch('https://api.openai.com/v1/models', {
    //   method: 'GET',
    //   headers: {
    //     'Authorization': `Bearer ${apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    // });

    // if (!response.ok) {
    //   if (response.status === 401) {
    //     throw new Error('Invalid OpenAI API key');
    //   } else if (response.status === 403) {
    //     throw new Error('Access denied - please check API key permissions');
    //   } else if (response.status === 429) {
    //     throw new Error('Rate limit exceeded');
    //   } else {
    //     throw new Error(`Connection failed: ${response.status}`);
    //   }
    // }

    // const data = await response.json();

    const response = await fetch('/.netlify/functions/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid API response');
    }

    return true;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error - please check your internet connection');
    }
    throw error;
  }
}

// Real OpenAI API integration
async function expandTextWithOpenAI(blocks, topic) {

  // Create a comprehensive prompt for the AI
  const prompt = `You are a clear and concise writer. Your goal is to write text that sounds natural to read out loud, using simple and direct language while staying polished and credible. Your task is to expand each of the following outline points into 1–2 natural, readable sentences. Match the tone of each point — if it's casual, stay casual; if it's formal, stay formal. Keep it simple, confident, and easy to read.

Each expansion should:
- Transform the basic point into professional, business language that is easy to read
- Copy the style and tone of the original points (if they are casual then casual, if they are authoritative then authoritative)
- Stay consistent an coherent to the overall topic of the writing, which is ${topic}

Outline points to expand:
${blocks.map((block, index) => `${index + 1}. ${block.summary}`).join('\n')}

Instructions:
- Use plain, everyday English (aim for clarity, not elegance)
- Write 1-2 concise sentences for each point
- Avoid fancy words, fillers, jargon, buzzwords, or overly complex phrasing
- Only include real evidence, data, or statistics **if the user explicitly asks for actual examples or numbers** in the outline points
- When you do include data or evidence, use **credible and verifiable sources** (e.g. government reports, major research studies, or reputable organizations) and **cite the source URL clearly in parentheses (e.g. data shows XXX (https://sample-url.com)**
- Do NOT fabricate or guess data
- Do NOT number each paragraph
- Make sure that the overall text is coherent with the topic, which is ${topic}

CRITICAL: Respond with ONLY a valid JSON array containing the expanded text for each point. Each array element should contain the expansion for the corresponding outline point (element 0 = expansion of point 1, element 1 = expansion of point 2, etc.). No additional text, explanations, or markdown formatting.

Format your response exactly like this:
[
  "Expansion of first outline point as 1-2 sentences.",
  "Expansion of second outline point as 1-2 sentences.",
  "Expansion of third outline point as 1-2 sentences."
]`;

  try {
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: 'gpt-4o-search-preview',
    //     web_search_options: {},
    //     messages: [
    //       {
    //         role: 'user',
    //         content: prompt
    //       }
    //     ],
    //     max_tokens: 2000,
    //   }),
    // });

    // if (!response.ok) {
    //   if (response.status === 401) {
    //     throw new Error('Invalid OpenAI API key. Please check your API key and try again.');
    //   } else if (response.status === 403) {
    //     throw new Error('Access denied to OpenAI API. Please check your API key permissions and billing status.');
    //   } else if (response.status === 429) {
    //     throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    //   } else if (response.status === 500) {
    //     throw new Error('OpenAI API server error. Please try again later.');
    //   } else {
    //     throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    //   }
    // }

    // const data = await response.json();


    const response = await fetch('/.netlify/functions/chat-completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-search-preview',
        prompt: prompt,
        maxTokens: 2000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // Log the complete API response for debugging
    console.log('=== OPENAI API RESPONSE ===');
    console.log('Full response:', JSON.stringify(data, null, 2));
    console.log('Message content:', data.choices?.[0]?.message?.content);
    console.log('=== END RESPONSE ===');
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }

    const content = data.choices[0].message.content.trim();
    
    try {
      // Parse the JSON array response
      const expansionsArray = JSON.parse(content);
      
      if (!Array.isArray(expansionsArray)) {
        throw new Error('Response is not an array');
      }
      
      console.log('Parsed expansions array:', expansionsArray);
      console.log(`Expected ${blocks.length} expansions, got ${expansionsArray.length}`);
      
      // Ensure we have the right number of expansions
      if (expansionsArray.length !== blocks.length) {
        console.warn(`Mismatch: expected ${blocks.length} expansions, got ${expansionsArray.length}`);
      }
      
      // Return the array instead of concatenating
      return expansionsArray;
      
    } catch (parseError) {
      console.error('Failed to parse JSON array, falling back to original content:', parseError);
      console.error('Content that failed to parse:', content);
      
      // Fallback: return array with original content
      return [content];
    }
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Unable to connect to OpenAI API. Please check your internet connection.');
    }
    throw error;
  }
}

// Regenerate expansion for a single block
async function regenerateSingleBlockExpansion(block, topic) {

  // Create a prompt for expanding just one block
  const prompt = `You are a clear and concise writer. Your goal is to write text that sounds natural to read out loud, using simple and direct language while staying polished and credible. Your task is to expand the following outline point into 1–2 natural, readable sentences.

Each expansion should:
- Transform the basic point into professional, business language that is easy to read
- Stay consistent and coherent to the overall topic of the writing, which is ${topic}

Outline point to expand:
${block.summary}

Instructions:
- Use plain, everyday English (aim for clarity, not elegance)
- Write 1-2 concise sentences for this point
- Avoid fancy words, fillers, jargon, buzzwords, or overly complex phrasing
- Only include real evidence, data, or statistics **if the user explicitly asks for actual examples or numbers** in the outline point
- When you do include data or evidence, use **credible and verifiable sources** (e.g. government reports, major research studies, or reputable organizations) and **cite the source URL clearly in parentheses (e.g. data shows XXX (https://sample-url.com)**
- Do NOT fabricate or guess data
- Make sure that the text is coherent with the topic, which is ${topic}

Respond with only the expanded text, no additional commentary or formatting.`;

  try {
    // const response = await fetch('https://api.openai.com/v1/chat/completions', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     model: 'gpt-4o-search-preview',
    //     web_search_options: {},
    //     messages: [
    //       {
    //         role: 'user',
    //         content: prompt
    //       }
    //     ],
    //     max_tokens: 2000,
    //   }),
    // });

    // if (!response.ok) {
    //   if (response.status === 401) {
    //     throw new Error('Invalid OpenAI API key. Please check your API key and try again.');
    //   } else if (response.status === 403) {
    //     throw new Error('Access denied to OpenAI API. Please check your API key permissions and billing status.');
    //   } else if (response.status === 429) {
    //     throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    //   } else if (response.status === 500) {
    //     throw new Error('OpenAI API server error. Please try again later.');
    //   } else {
    //     throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    //   }
    // }

    // const data = await response.json();

    const response = await fetch('/.netlify/functions/chat-completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-search-preview',
        prompt: prompt,
        maxTokens: 2000,
        temperature: 0.7
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    console.log('=== SINGLE BLOCK REGENERATION RESPONSE ===');
    console.log('Block:', block.summary);
    console.log('Response:', data.choices?.[0]?.message?.content);
    console.log('=== END SINGLE BLOCK RESPONSE ===');
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response format from OpenAI API');
    }

    return data.choices[0].message.content.trim();
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Unable to connect to OpenAI API. Please check your internet connection.');
    }
    throw error;
  }
}



// Helper function to generate title from text
function generateTitle(text) {
  const cleanText = text.trim();
  
  // If text is very short, just return it as-is
  if (cleanText.length <= 20) {
    return cleanText;
  }
  
  // Common stop words to filter out (excluding important business terms)
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'would', 'you', 'your',
    'can', 'could', 'should', 'may', 'might', 'must', 'shall'
  ]);
  
  // Split into words and clean them
  const words = cleanText.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .split(/\s+/)
    .filter(word => word.length > 0);
  
  // Find important words (not stop words, longer than 2 characters)
  const importantWords = words.filter(word => 
    !stopWords.has(word) && word.length > 2
  );
  
  // If we have important words, use them; otherwise fall back to first few words
  const wordsToUse = importantWords.length >= 2 ? importantWords : words;
  
  // Take up to 4 important words or 6 regular words
  const maxWords = importantWords.length >= 2 ? 4 : 6;
  const selectedWords = wordsToUse.slice(0, maxWords);
  
  // Capitalize each word properly
  const capitalizedWords = selectedWords.map(word => {
    // Handle common acronyms and abbreviations
    const upperCaseWords = ['ai', 'api', 'ui', 'ux', 'seo', 'roi', 'ceo', 'cto', 'hr'];
    if (upperCaseWords.includes(word.toLowerCase())) {
      return word.toUpperCase();
    }
    // Capitalize first letter of each word
    return word.charAt(0).toUpperCase() + word.slice(1);
  });
  
  let title = capitalizedWords.join(' ');
  
  // If the title is much shorter than original and under the limit, don't add ellipsis
  if (title.length < 35 && title.length < cleanText.length * 0.7) {
    // Try to add one more word if it fits
    const nextWordIndex = selectedWords.length;
    if (nextWordIndex < wordsToUse.length) {
      const nextWord = wordsToUse[nextWordIndex];
      const potentialTitle = title + ' ' + nextWord.charAt(0).toUpperCase() + nextWord.slice(1);
      if (potentialTitle.length <= 45) {
        title = potentialTitle;
      }
    }
  }
  
  // Add ellipsis if we truncated significantly
  if (title.length < cleanText.length * 0.8 && title.length < 47) {
    title += '...';
  }
  
  // Ensure we don't exceed the 50 character limit
  if (title.length > 50) {
    title = title.slice(0, 47) + '...';
  }
  
  return title;
}

// Editable text component
function EditableText({ value, onSave, placeholder, className, isTitle = false, maxLength }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleSave = useCallback(() => {
    const trimmedValue = editValue.trim();
    if (trimmedValue && trimmedValue !== value) {
      onSave(trimmedValue);
    }
    setIsEditing(false);
  }, [editValue, value, onSave]);

  const handleCancel = useCallback(() => {
    setEditValue(value);
    setIsEditing(false);
  }, [value]);

  const handleKeyDown = useCallback((e) => {
    // Only handle specific keys we care about, let everything else pass through
    if (e.key === 'Enter' && (isTitle || !e.shiftKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
    // All other keys (including Cmd+A, Cmd+C, etc.) will be handled by the browser
  }, [isTitle, handleSave, handleCancel]);

  const handleClick = useCallback(() => {
    if (!isEditing) {
      setIsEditing(true);
    }
  }, [isEditing]);

  const handleBlur = useCallback(() => {
    handleSave();
  }, [handleSave]);

  if (isEditing) {
    if (isTitle) {
      return (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`${className} w-full bg-white border border-blue-300 rounded px-1 -mx-1`}
          placeholder={placeholder}
          maxLength={maxLength}
        />
      );
    } else {
      return (
        <textarea
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`${className} w-full bg-white border border-blue-300 rounded px-1 -mx-1 resize-none min-h-[3em]`}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={2}
        />
      );
    }
  }

  return (
    <div
      onClick={handleClick}
      className={`${className} cursor-pointer hover:bg-gray-100 text-black rounded px-1 -mx-1 transition-colors`}
      title="Click to edit"
    >
      {value || placeholder}
    </div>
  );
}

// Topic Input Component
function TopicInput({ onGenerateBlocks, isGenerating, openaiConnected }) {
  const [topic, setTopic] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea function
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight or minimum 3 lines
      const lineHeight = 24; // Approximate line height
      const minHeight = lineHeight * 3; // 3 lines minimum
      const newHeight = Math.max(textarea.scrollHeight, minHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

  // Adjust height when component mounts and when topic changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [topic, adjustTextareaHeight]);

  const handleGenerate = () => {
    if (topic.trim()) {
      if (!openaiConnected) {
        alert('Please connect to OpenAI in the settings above to generate writing blocks.');
        return;
      }
      onGenerateBlocks(topic.trim());
    }
  };

  const handleKeyDown = useCallback((e) => {
    // Only handle Enter key for generation, let browser handle all other keys
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
    // All other keys (including Cmd+A, Cmd+C, etc.) will be handled by the browser
  }, [handleGenerate]);

  const handleChange = (e) => {
    setTopic(e.target.value);
    // Adjust height after state update
    setTimeout(adjustTextareaHeight, 0);
  };

  const canGenerate = topic.trim() && !isGenerating;

  return (
    <div className="bg-[rgba(248,248,248,1)] rounded-lg p-4 mb-6">
      <h3 className="font-['Chivo:Bold',_sans-serif] text-[16px] text-[#000000] mb-3">
        Generate Writing Blocks for Your Topic
      </h3>
      
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block font-['Chivo:Regular',_sans-serif] text-[12px] text-[#666666] mb-1">
            What would you like to write about?
          </label>
          <textarea
            ref={textareaRef}
            value={topic}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="e.g., email to negotiate rent increase, job application cover letter, product launch announcement..."
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-['Chivo:Regular',_sans-serif] text-[14px] resize-none overflow-hidden leading-6 bg-[#fcfcfc]"
            style={{ minHeight: '72px' }} // 3 lines * 24px line height
            disabled={isGenerating}
            rows={3}
          />
        </div>
        <button
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="bg-[#1b00b6] text-white px-4 py-2 rounded hover:bg-blue-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-['Chivo:Bold',_sans-serif] text-[12px] h-fit"
        >
          {isGenerating ? 'Generating...' : 'Generate Blocks'}
        </button>
      </div>
      
      <div className="text-[11px] text-gray-600 font-['Chivo:Regular',_sans-serif] mt-2">
        {!openaiConnected && (
          <p className="text-orange-600">• Connect to OpenAI above to generate custom writing blocks</p>
        )}
      </div>
    </div>
  );
}

// AI Settings Panel Component
// function AISettingsPanel({ openaiApiKey, setOpenaiApiKey, onConnectionChange }) {
//   const [showApiKey, setShowApiKey] = useState(false);
//   const [isConnected, setIsConnected] = useState(false);
//   const [isConnecting, setIsConnecting] = useState(false);
//   const [connectionError, setConnectionError] = useState('');

//   // Notify parent component when connection status changes
//   useEffect(() => {
//     if (onConnectionChange) {
//       onConnectionChange(isConnected);
//     }
//   }, [isConnected, onConnectionChange]);

//   const handleConnect = async () => {
//     if (!openaiApiKey.trim()) {
//       setConnectionError('Please enter your API key first');
//       return;
//     }

//     setIsConnecting(true);
//     setConnectionError('');

//     try {
//       await testOpenAIConnection();
//       setIsConnected(true);
//       setConnectionError('');
//     } catch (error) {
//       setConnectionError(error.message);
//       setIsConnected(false);
//     } finally {
//       setIsConnecting(false);
//     }
//   };

//   const handleDisconnect = () => {
//     setIsConnected(false);
//     setConnectionError('');
//   };
  
//   return (
//     <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
//       <h3 className="font-['Chivo:Bold',_sans-serif] text-[16px] text-[#000000] mb-3">OpenAI Connection</h3>
      
//       <div className="flex flex-col gap-3">
//         <div className="flex items-center gap-4">
//           <span className="font-['Chivo:Regular',_sans-serif] text-[14px] text-[#000000]">
//             ChatGPT Integration
//           </span>
//           {isConnected && (
//             <>
//               <span className="bg-green-100 text-green-800 text-[10px] px-2 py-1 rounded-full font-['Chivo:Bold',_sans-serif]">
//                 Connected
//               </span>
//               <button
//                 type="button"
//                 onClick={handleDisconnect}
//                 className="text-blue-600 hover:text-blue-800 font-['Chivo:Regular',_sans-serif] text-[12px] underline ml-2"
//               >
//                 Change
//               </button>
//             </>
//           )}
//         </div>
        
//         {!isConnected && (
//           <div className="flex gap-2 items-center">
//             <div className="flex-1">
//               <input
//                 type={showApiKey ? "text" : "password"}
//                 placeholder="Enter your OpenAI API key (sk-...)"
//                 value={openaiApiKey}
//                 onChange={(e) => setOpenaiApiKey(e.target.value)}
//                 className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-['Chivo:Regular',_sans-serif] text-[14px]"
//               />
//             </div>
//             <button
//               type="button"
//               onClick={() => setShowApiKey(!showApiKey)}
//               className="px-3 py-2 text-gray-500 hover:text-gray-700 font-['Chivo:Regular',_sans-serif] text-[12px]"
//             >
//               {showApiKey ? 'Hide' : 'Show'}
//             </button>
//             <button
//               type="button"
//               onClick={handleConnect}
//               disabled={isConnecting || !openaiApiKey.trim()}
//               className="bg-[#1b00b6] text-white px-4 py-2 rounded hover:bg-blue-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-['Chivo:Bold',_sans-serif] text-[12px]"
//             >
//               {isConnecting ? 'Connecting...' : 'Connect'}
//             </button>
//           </div>
//         )}

//         {!isConnected && (
//           <>
//             {connectionError && (
//               <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
//                 <p className="font-['Chivo:Regular',_sans-serif] text-[12px]">
//                   Connection failed: {connectionError}
//                 </p>
//               </div>
//             )}
            
//             <div className="text-[12px] text-gray-600 font-['Chivo:Regular',_sans-serif]">
//               <p>• Real ChatGPT integration with high-quality expansions</p>
//               <p>• Uses GPT-4o-mini model for cost-effective, high-quality results</p>
//               <p>• Your API key is not stored and only used for this session</p>
//               <p>• Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">OpenAI Platform</a></p>
//             </div>
//           </>
//         )}
//       </div>
//     </div>
//   );
// }

function AISettingsPanel({ onConnectionChange }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(isConnected);
    }
  }, [isConnected, onConnectionChange]);

  const handleConnect = async () => {
    setIsConnecting(true);
    setConnectionError('');

    try {
      await testOpenAIConnection();
      setIsConnected(true);
      setConnectionError('');
    } catch (error) {
      setConnectionError(error.message);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
      <h3 className="font-['Chivo:Bold',_sans-serif] text-[16px] text-[#000000] mb-3">OpenAI Connection</h3>
      
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <span className="font-['Chivo:Regular',_sans-serif] text-[14px] text-[#000000]">
            ChatGPT Integration
          </span>
          {isConnected ? (
            <span className="bg-green-100 text-green-800 text-[10px] px-2 py-1 rounded-full font-['Chivo:Bold',_sans-serif]">
              Connected
            </span>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting}
              className="bg-[#1b00b6] text-white px-4 py-2 rounded hover:bg-blue-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-['Chivo:Bold',_sans-serif] text-[12px]"
            >
              {isConnecting ? 'Connecting...' : 'Test Connection'}
            </button>
          )}
        </div>

        {connectionError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
            <p className="font-['Chivo:Regular',_sans-serif] text-[12px]">
              Connection failed: {connectionError}
            </p>
          </div>
        )}
        
        <div className="text-[12px] text-gray-600 font-['Chivo:Regular',_sans-serif]">
          <p>• API key is configured server-side for security</p>
          <p>• Uses GPT-4o models for high-quality results</p>
          <p>• No API key storage or exposure in browser</p>
        </div>
      </div>
    </div>
  );
}

// Drag handle component (preserved from Figma design)
function DragHandle() {
  return (
    <div className="h-3 relative shrink-0 w-[6.857px]">
      <svg
        className="block size-full"
        fill="none"
        preserveAspectRatio="none"
        viewBox="0 0 7 12"
      >
        <g>
          <circle cx="0.857143" cy="0.857143" fill="#808080" r="0.857143" />
          <circle cx="0.857143" cy="5.99985" fill="#808080" r="0.857143" />
          <circle cx="0.857143" cy="11.1429" fill="#808080" r="0.857143" />
          <circle cx="6" cy="0.857143" fill="#808080" r="0.857143" />
          <circle cx="6" cy="5.99985" fill="#808080" r="0.857143" />
          <circle cx="6" cy="11.1429" fill="#808080" r="0.857143" />
        </g>
      </svg>
    </div>
  );
}

// Collaboration cursor indicator
function WriterCursor({ isVisible, position, userName = "Writer 1" }) {
  if (!isVisible) return null;

  return (
    <div 
      className="absolute h-10 w-[57px] pointer-events-none z-50 transition-opacity duration-200"
      style={{
        left: position.x,
        top: position.y,
        opacity: isVisible ? 1 : 0
      }}
    >
      <div className="absolute bottom-1/2 left-0 right-[98.246%] top-0">
        <svg
          className="block size-full"
          fill="none"
          preserveAspectRatio="none"
          viewBox="0 0 1 20"
        >
          <path
            d={svgPaths.p1d15f000}
            fill="#F42C04"
          />
        </svg>
      </div>
      <div className="absolute bg-[#f42c04] bottom-0 left-0 right-0 top-1/2 rounded">
        <div className="flex flex-row items-center justify-center relative size-full">
          <div className="box-border content-stretch flex flex-row gap-2.5 items-center justify-center px-2 py-1 relative">
            <div className="font-['Chivo:Bold',_sans-serif] leading-[0] not-italic relative shrink-0 text-[#ffffff] text-[10px] text-center text-nowrap">
              <p className="block leading-[normal] whitespace-pre">{userName}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Loading spinner component
function LoadingSpinner({ message }) {
  return (
    <div className="flex items-center justify-center space-x-2">
      <div className="animate-spin rounded-full h-4 w-4 min-h-4 min-w-4 border-2 border-blue-600 border-t-transparent flex-shrink-0"></div>
      <span className="text-sm text-gray-600 flex-1 text-center">
        {message || 'ChatGPT is working...'}
      </span>
    </div>
  );
}

// Draggable block component for sidebar
function WritingBlock({ block, isDragging, onUpdate }) {
  const [{ opacity }, drag] = useDrag({
    type: 'block',
    item: { id: block.id, title: block.title, summary: block.summary, source: 'sidebar' },
    collect: (monitor) => ({
      opacity: monitor.isDragging() ? 0.5 : 1,
    }),
  });

  const handleTitleUpdate = useCallback((newTitle) => {
    if (onUpdate) {
      onUpdate(block.id, { ...block, title: newTitle });
    }
  }, [block, onUpdate]);

  const handleSummaryUpdate = useCallback((newSummary) => {
    if (onUpdate) {
      onUpdate(block.id, { ...block, summary: newSummary });
    }
  }, [block, onUpdate]);

  return (
    <div
      ref={drag}
      className="bg-[#EDF2FB] rounded mb-2 cursor-move"
      style={{ opacity }}
    >
      <div className="flex flex-row items-center relative size-full">
        <div className="box-border content-stretch flex flex-row gap-3 items-center justify-start pb-2 pl-1 pr-5 pt-1 relative w-full">
          <DragHandle />
          <div className="basis-0 grow min-h-px min-w-px relative shrink-0">
            <div className="box-border content-stretch flex flex-col gap-1 items-start justify-center p-0 relative w-full">
              <div className="font-['Chivo:Bold',_sans-serif] leading-[0] not-italic relative shrink-0 text-[#000000] text-[14px] text-left">
                <EditableText
                  value={block.title}
                  onSave={handleTitleUpdate}
                  placeholder="Block title..."
                  className="block leading-[1.4375] whitespace-pre capitalize"
                  isTitle={true}
                  maxLength={50}
                />
              </div>
              <div className="relative shrink-0 w-full">
                <div className="box-border content-stretch flex flex-col gap-1 items-start justify-start p-0 relative w-full">
                  <div className="font-['Chivo:Regular',_sans-serif] text-[12px] text-[#666666] leading-[1.2] overflow-hidden">
                    <EditableText
                      value={block.summary}
                      onSave={handleSummaryUpdate}
                      placeholder="Block summary..."
                      className="block line-clamp-2"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Draggable block component for dropped blocks in editor
function DroppedBlock({ block, index, onMove, onRemove, draggedBlockId, onDragStart, onDragEnd, onUpdate, isGeneratingTitle, onRegenerate, isRegenerating }) {
  const [{ opacity, isDragging }, drag] = useDrag({
    type: 'dropped-block',
    item: { 
      id: block.id, 
      title: block.title, 
      summary: block.summary, 
      index,
      source: 'editor' 
    },
    collect: (monitor) => ({
      opacity: monitor.isDragging() ? 0.5 : 1,
      isDragging: monitor.isDragging(),
    }),
    end: () => {
      onDragEnd();
    },
  });

  const [, drop] = useDrop({
    accept: 'dropped-block',
    hover: (draggedItem) => {
      if (draggedItem.index !== index) {
        onMove(draggedItem.index, index);
        draggedItem.index = index;
      }
    },
  });

  // State for hover tracking
  const [isHovered, setIsHovered] = useState(false);

  // Track when this block starts being dragged
  useEffect(() => {
    if (isDragging && draggedBlockId !== block.id) {
      onDragStart(block.id);
    }
  }, [isDragging, block.id, draggedBlockId, onDragStart]);

  // Use light orange for custom blocks, light purple for predefined blocks
  const bgColor = block.source === 'custom' ? 'bg-[#FFEDD8]' : 'bg-[#EDF2FB]';

  // Determine timeline stroke color:
  // - Blue if this block is being dragged
  // - Blue if this block is hovered AND no other block is being dragged
  // - White otherwise
  const timelineStroke = (isDragging || (isHovered && !draggedBlockId)) ? "#1B00B6" : "#ffffff";

  const handleTitleUpdate = useCallback((newTitle) => {
    if (onUpdate) {
      onUpdate(index, { ...block, title: newTitle });
    }
  }, [block, index, onUpdate]);

  const handleSummaryUpdate = useCallback((newSummary) => {
    if (onUpdate) {
      onUpdate(index, { ...block, summary: newSummary });
    }
  }, [block, index, onUpdate]);

  return (
    <div 
      ref={(node) => drag(drop(node))} 
      className="relative" 
      style={{ opacity }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Timeline connector */}
      <div className="absolute left-0 top-0 h-[70px] w-0">
        <div className="absolute bottom-[-1.429%] left-[-1px] right-[-1px] top-[-1.429%]">
          <svg
            className="block size-full"
            fill="none"
            preserveAspectRatio="none"
            viewBox="0 0 2 72"
          >
            <path
              d="M1 1V71"
              stroke={timelineStroke}
              strokeLinecap="round"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>
      
      {/* Block content */}
      <div className={`ml-6 ${bgColor} rounded p-3 mb-2 cursor-move`}>
        <div className="flex items-center gap-3">
          <DragHandle />
          <div className="flex-1">
            <div className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000] capitalize flex items-center gap-2">
              {isGeneratingTitle ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-3 w-3 border-2 border-blue-600 border-t-transparent"></div>
                  <span className="text-gray-500 text-[12px]">Generating title...</span>
                </div>
              ) : (
                <EditableText
                  value={block.title}
                  onSave={handleTitleUpdate}
                  placeholder="Block title..."
                  className=""
                  isTitle={true}
                  maxLength={50}
                />
              )}
            </div>
            <div className="font-['Chivo:Regular',_sans-serif] text-[12px] text-[#666666] leading-[1.2] overflow-hidden mt-1">
              <EditableText
                value={block.summary}
                onSave={handleSummaryUpdate}
                placeholder="Block summary..."
                className="block line-clamp-2"
              />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onRegenerate && onRegenerate(index)}
              disabled={isRegenerating}
              className="text-blue-500 hover:text-blue-700 p-1 disabled:text-gray-400 disabled:cursor-not-allowed"
              title="Regenerate this block's expansion"
            >
              {isRegenerating ? (
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
              ) : (
                <RotateCcw size={16} />
              )}
            </button>
            <button
              onClick={() => onRemove(index)}
              className="text-red-500 hover:text-red-700 p-1"
              title="Remove block"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Text editing area with drop zone
function TextEditor({ droppedBlocks, onDrop, onMove, onRemove, onTextChange, customText, onAddCustomBlock, onUpdateDroppedBlock, generatingTitleForBlocks, onRegenerateBlock, regeneratingBlocks }) {
  const [{ isOver }, drop] = useDrop({
    accept: ['block', 'dropped-block'],
    drop: (item, monitor) => {
      if (item.source === 'sidebar') {
        onDrop(item);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
    }),
  });

  // Track which block is currently being dragged
  const [draggedBlockId, setDraggedBlockId] = useState(null);

  const textareaRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const typingTimeoutRef = useRef(null);

  const updateCursorPosition = useCallback(() => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const cursorPos = textarea.selectionStart;
    
    // Create a temporary div to measure text position
    const div = document.createElement('div');
    const style = window.getComputedStyle(textarea);
    
    // Copy textarea styles to the div
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.font = style.font;
    div.style.padding = style.padding;
    div.style.border = style.border;
    div.style.width = style.width;
    div.style.height = style.height;
    
    document.body.appendChild(div);
    
    // Get text up to cursor position
    const textBeforeCursor = textarea.value.substring(0, cursorPos);
    div.textContent = textBeforeCursor;
    
    // Add a span to measure cursor position
    const span = document.createElement('span');
    span.textContent = '|';
    div.appendChild(span);
    
    const textareaRect = textarea.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    
    setCursorPosition({
      x: spanRect.left - textareaRect.left + textarea.scrollLeft,
      y: spanRect.top - textareaRect.top + textarea.scrollTop
    });
    
    document.body.removeChild(div);
  }, []);

  const handleTextInput = useCallback((e) => {
    onTextChange(e.target.value);
    setIsTyping(true);
    updateCursorPosition();
    
    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Set new timeout to hide cursor after 2 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 2000);
  }, [onTextChange, updateCursorPosition]);

  const handleCursorMove = useCallback((e) => {
    if (isTyping) {
      updateCursorPosition();
    }
  }, [isTyping, updateCursorPosition]);

  const handleFocus = useCallback(() => {
    setIsTyping(true);
    updateCursorPosition();
  }, [updateCursorPosition]);

  const handleBlur = useCallback(() => {
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="bg-[#ffffff] min-h-[400px] w-full border border-gray-200 rounded-lg">
      <div className="min-h-[400px] overflow-clip relative w-full">
        {/* Drop zone */}
        <div
          ref={drop}
          className={`p-6 rounded-lg min-h-[400px] ${
            isOver ? 'bg-blue-50 border-2 border-dashed border-blue-300' : ''
          }`}
        >
          <div className="space-y-4">
            {droppedBlocks.map((block, index) => (
              <DroppedBlock
                key={`${block.id}-${index}`}
                block={block}
                index={index}
                onMove={onMove}
                onRemove={onRemove}
                draggedBlockId={draggedBlockId}
                onDragStart={setDraggedBlockId}
                onDragEnd={() => setDraggedBlockId(null)}
                onUpdate={onUpdateDroppedBlock}
                isGeneratingTitle={generatingTitleForBlocks.has(block.id)}
                onRegenerate={onRegenerateBlock}
                isRegenerating={regeneratingBlocks.has(index)}
              />
            ))}
            
            {droppedBlocks.length === 0 && (
              <div className="text-center text-gray-500 py-16">
                <p className="text-lg">Drop writing blocks here to start building your draft</p>
                <p className="text-sm mt-2">Or type manually below</p>
              </div>
            )}
            
            {/* Manual text input area */}
            <div className="mt-6 relative">
              <div className="flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={customText}
                  onChange={handleTextInput}
                  onKeyUp={handleCursorMove}
                  onClick={handleCursorMove}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  placeholder="Add your own blocks here..."
                  className="flex-1 h-20 p-3 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                
                <button
                  onClick={onAddCustomBlock}
                  disabled={!customText.trim()}
                  className="bg-[#1b00b6] text-white px-4 py-2 rounded hover:bg-blue-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed h-fit"
                  title="Add text as block"
                >
                  Add
                </button>
              </div>
              
              {/* Writer cursor indicator */}
              <WriterCursor
                isVisible={isTyping}
                position={cursorPosition}
                userName="Writer 1"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Develop Text Button Component
function DevelopTextButton({ droppedBlocks, onDevelopText, isGenerating, openaiConnected }) {
  if (isGenerating) {
    return (
      <div className="mt-4 flex justify-center">
        <LoadingSpinner message="ChatGPT is expanding your text..." />
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col items-center">
      <button
        onClick={onDevelopText}
        className="bg-[#1b00b6] text-white px-10 py-6 rounded hover:bg-blue-800 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed font-['Chivo:Bold',_sans-serif] text-[16px] text-center font-bold"
        disabled={droppedBlocks.length === 0 || !openaiConnected}
      >
        Develop full text
      </button>
      {droppedBlocks.length === 0 && (
        <p className="text-sm text-gray-500 mt-2 text-center">
          Add some writing blocks first to get started
        </p>
      )}
      {!openaiConnected && (
        <p className="text-sm text-orange-600 mt-2 text-center">
          Connect to OpenAI in settings to use ChatGPT
        </p>
      )}
    </div>
  );
}

// Developed Text Panel Component
function DevelopedTextPanel({ fullText, onTextChange, isGenerating }) {
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current && fullText) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(textarea.scrollHeight, 400)}px`;
    }
  }, [fullText]);

  const handleTextChange = useCallback((e) => {
    onTextChange(e.target.value);
  }, [onTextChange]);

  if (fullText) {
    return (
      <textarea
        ref={textareaRef}
        value={fullText}
        onChange={handleTextChange}
        className={`w-full p-4 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-['Chivo:Regular',_sans-serif] text-[14px] leading-[1.4375] bg-[#ffffff] transition-all duration-300 ${
          isGenerating ? 'blur-sm opacity-75' : ''
        }`}
        style={{ minHeight: '400px' }}
        placeholder="Your developed text will appear here..."
        disabled={isGenerating}
      />
    );
  }

  return (
    <div className="bg-[#ffffff] min-h-[400px] w-full border border-gray-200 rounded-lg">
      <div className="flex items-center justify-center h-[400px] p-8 text-center">
        <p className="text-gray-500">
          Click "Develop full text" in the left panel to generate your expanded text here.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [droppedBlocks, setDroppedBlocks] = useState([]);
  const [customText, setCustomText] = useState('');
  const [fullText, setFullText] = useState('');
  const [expandedTextArray, setExpandedTextArray] = useState([]); // Track expanded text as array
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingBlocks, setRegeneratingBlocks] = useState(new Set()); // Track which blocks are being regenerated
  const [nextBlockId, setNextBlockId] = useState(1000); // Start custom blocks at ID 1000

  //const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [error, setError] = useState('');
  const [generatingTitleForBlocks, setGeneratingTitleForBlocks] = useState(new Set());
  
  // New state for dynamic blocks
  const [writingBlocks, setWritingBlocks] = useState(DEFAULT_WRITING_BLOCKS);
  const [isGeneratingBlocks, setIsGeneratingBlocks] = useState(false);
  const [currentTopic, setCurrentTopic] = useState('');
  const [openaiConnected, setOpenaiConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Load API key from .env file and setOpenaiConnected to true when app loads
  // useEffect(() => {
  //   const apiKey = import.meta.env.VITE_OPEN_AI_KEY;
  //   if (apiKey) {
  //     setOpenaiApiKey(apiKey);
      
  //     // Auto-connect with the loaded API key
  //     const autoConnect = async () => {
  //       try {
  //         await testOpenAIConnection();
  //         setOpenaiConnected(true);
  //       } catch (error) {
  //         console.warn('Auto-connection failed:', error.message);
  //         // Don't set error state here since user didn't manually try to connect
  //       }
  //     };
      
  //     autoConnect();
  //   }
  // }, []);

  // Auto-connect when app loads
  useEffect(() => {
    const autoConnect = async () => {
      try {
        await testOpenAIConnection();
        setOpenaiConnected(true);
      } catch (error) {
        console.warn('Auto-connection failed:', error.message);
        // Show settings if auto-connection fails
        setShowSettings(true);
      }
    };
    
    autoConnect();
  }, []);

  const handleConnectionChange = useCallback((connected) => {
    setOpenaiConnected(connected);
    // Hide settings panel after successful connection
    if (connected) {
      setShowSettings(false);
    }
  }, []);

  const handleGenerateBlocks = useCallback(async (topic) => {
    if (!openaiConnected) {
      setError('Please connect to OpenAI in the settings above to generate writing blocks.');
      return;
    }
    
    setIsGeneratingBlocks(true);
    setError('');
    setCurrentTopic(topic);
    
    try {
      const newBlocks = await generateBlocksWithOpenAI(topic);
      setWritingBlocks(newBlocks);
    } catch (error) {
      console.error('Error generating blocks:', error);
      setError(`Failed to generate blocks: ${error.message}`);
    } finally {
      setIsGeneratingBlocks(false);
    }
  }, [openaiConnected]);

  const handleGenerateMoreBlocks = useCallback(async () => {
    if (!openaiConnected) {
      setError('Please connect to OpenAI in the settings above to generate more blocks.');
      return;
    }
    
    setIsGeneratingBlocks(true);
    setError('');
    
    try {
      const additionalBlocks = await generateMoreBlocksWithOpenAI(currentTopic, writingBlocks);
      // Append the new blocks to existing ones
      setWritingBlocks(prev => [...prev, ...additionalBlocks]);
    } catch (error) {
      console.error('Error generating additional blocks:', error);
      setError(`Failed to generate additional blocks: ${error.message}`);
    } finally {
      setIsGeneratingBlocks(false);
    }
  }, [openaiConnected, currentTopic, writingBlocks]);

  const handleUpdateBlock = useCallback((blockId, updatedBlock) => {
    setWritingBlocks(prev => prev.map(block => 
      block.id === blockId ? updatedBlock : block
    ));
  }, []);

  const handleUpdateDroppedBlock = useCallback((index, updatedBlock) => {
    setDroppedBlocks(prev => prev.map((block, i) => 
      i === index ? updatedBlock : block
    ));
  }, []);

  const handleDrop = useCallback((item) => {
    setDroppedBlocks(prev => [...prev, item]);
  }, []);

  const handleMove = useCallback((fromIndex, toIndex) => {
    setDroppedBlocks(prev => {
      const newBlocks = [...prev];
      const [removed] = newBlocks.splice(fromIndex, 1);
      newBlocks.splice(toIndex, 0, removed);
      return newBlocks;
    });
  }, []);

  const handleRemove = useCallback((index) => {
    setDroppedBlocks(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleTextChange = useCallback((text) => {
    setCustomText(text);
  }, []);

  const handleFullTextChange = useCallback((text) => {
  setFullText(text);
  
  // Sync changes back to expandedTextArray to preserve manual edits
  if (droppedBlocks.length > 0) {
    // Split the text by double newlines (the separator we use when joining)
    const textParts = text.split('\n\n');
    
    // Update expandedTextArray with the manually edited parts
    setExpandedTextArray(prev => {
      const newArray = [...prev];
      
      // Update existing parts
      for (let i = 0; i < Math.min(textParts.length, droppedBlocks.length); i++) {
        newArray[i] = textParts[i];
      }
      
      // If user added more text parts than blocks, keep them as additional entries
      if (textParts.length > droppedBlocks.length) {
        for (let i = droppedBlocks.length; i < textParts.length; i++) {
          newArray[i] = textParts[i];
        }
      }
      
      return newArray;
    });
  }
}, [droppedBlocks]);

  const handleAddCustomBlock = useCallback(async () => {
    if (!customText.trim()) return;
    
    const blockId = nextBlockId;
    const text = customText.trim();
    
    // Create block immediately with placeholder title
    const newBlock = {
      id: blockId,
      title: 'Generating title...',
      summary: text,
      source: 'custom'
    };
    
    // Add block to draft immediately
    setDroppedBlocks(prev => [...prev, newBlock]);
    setCustomText('');
    setNextBlockId(prev => prev + 1);
    
    // Mark this block as having title generation in progress
    setGeneratingTitleForBlocks(prev => new Set([...prev, blockId]));
    
    // Generate title in background
    try {
      let title;
      
      // Try to generate title with OpenAI if connected
      if (openaiConnected) {
        try {
          title = await generateTitleWithOpenAI(text);
        } catch (error) {
          console.warn('Failed to generate title with OpenAI, falling back to local generation:', error);
          title = generateTitle(text);
        }
      } else {
        // Use local title generation (no async needed, but add small delay for UX)
        await new Promise(resolve => setTimeout(resolve, 500));
        title = generateTitle(text);
      }
      
      // Update the block with the generated title
      setDroppedBlocks(prev => prev.map(block => 
        block.id === blockId ? { ...block, title } : block
      ));
    } catch (error) {
      console.error('Failed to generate title:', error);
      // Fallback to local generation
      const fallbackTitle = generateTitle(text);
      setDroppedBlocks(prev => prev.map(block => 
        block.id === blockId ? { ...block, title: fallbackTitle } : block
      ));
    } finally {
      // Remove from generating set
      setGeneratingTitleForBlocks(prev => {
        const newSet = new Set(prev);
        newSet.delete(blockId);
        return newSet;
      });
    }
  }, [customText, nextBlockId, openaiConnected]);

  const handleDevelopText = useCallback(async () => {
    if (!openaiConnected) {
      setError('Please connect to OpenAI in the settings above to develop text.');
      return;
    }
    
    setIsGenerating(true);
    setError('');
    
    try {
      const expandedArray = await expandTextWithOpenAI(droppedBlocks, currentTopic);
      setExpandedTextArray(expandedArray);
      setFullText(expandedArray.join('\n\n'));
    } catch (error) {
      console.error('Error expanding text:', error);
      setError(error.message);
      
      // Final fallback to original text
      const blockTexts = droppedBlocks.map(block => block.summary);
      setExpandedTextArray(blockTexts);
      setFullText(blockTexts.join('\n\n'));
      setError('OpenAI failed, showing original text: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  }, [droppedBlocks, openaiConnected, currentTopic]);

  const handleRegenerateBlock = useCallback(async (blockIndex) => {
    if (!openaiConnected) {
      setError('Please connect to OpenAI in the settings above to regenerate.');
      return;
    }

    if (blockIndex >= droppedBlocks.length) {
      setError('Invalid block index for regeneration.');
      return;
    }

    const blockToRegenerate = droppedBlocks[blockIndex];
    
    // Add block to regenerating set
    setRegeneratingBlocks(prev => new Set([...prev, blockIndex]));
    setError('');

    try {
      const newExpansion = await regenerateSingleBlockExpansion(blockToRegenerate, currentTopic);
      
      // Update the specific index in the expanded text array
      setExpandedTextArray(prev => {
        const newArray = [...prev];
        newArray[blockIndex] = newExpansion;
        setFullText(newArray.join('\n\n'));
        return newArray;
      });

      // Update the concatenated full text
      // setFullText(prev => {
      //   const textArray = [...expandedTextArray];
      //   textArray[blockIndex] = newExpansion;
      //   return textArray.join('\n\n');
      // });
    } catch (error) {
      console.error('Error regenerating block:', error);
      setError(`Failed to regenerate block: ${error.message}`);
    } finally {
      // Remove block from regenerating set
      setRegeneratingBlocks(prev => {
        const newSet = new Set(prev);
        newSet.delete(blockIndex);
        return newSet;
      });
    }
  }, [droppedBlocks, openaiConnected, currentTopic]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="bg-[#ffffff] relative rounded-[20px] size-full">
        <div className="overflow-auto relative size-full p-20">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="font-['Chivo:Bold',_sans-serif] not-italic text-[#000000] text-left" style={{fontSize: '32px', marginBottom: '8px'}}>
              <p className="block leading-[normal]">Let's prototype your writing</p>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-md transition-colors ${
                openaiConnected
                  ? 'text-green-600 hover:text-green-800 hover:bg-green-100'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
              title="Settings"
            >
              <Settings size={20} />
            </button>
          </div>

          {/* AI Settings Panel */}
          {showSettings && (
            <AISettingsPanel
              onConnectionChange={handleConnectionChange}
            />
          )}

          {/* Error display */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
              <p className="font-['Chivo:Regular',_sans-serif] text-[14px]">{error}</p>
            </div>
          )}

          {/* Full-width top section */}
          <div className="space-y-6 mb-8">
            {/* Topic Input */}
            <TopicInput
              onGenerateBlocks={handleGenerateBlocks}
              isGenerating={isGeneratingBlocks}
              openaiConnected={openaiConnected}
            />

            {/* Writing blocks grid */}
            <div className="w-full">
              {/* Show existing blocks if they exist */}
              {writingBlocks.length > 0 && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                    {writingBlocks.slice(0, 8).map((block) => (
                      <WritingBlock key={block.id} block={block} onUpdate={handleUpdateBlock} />
                    ))}
                  </div>
                  {writingBlocks.length > 8 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                      {writingBlocks.slice(8, 16).map((block) => (
                        <WritingBlock key={block.id} block={block} onUpdate={handleUpdateBlock} />
                      ))}
                    </div>
                  )}
                  {writingBlocks.length > 16 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                      {writingBlocks.slice(16).map((block) => (
                        <WritingBlock key={block.id} block={block} onUpdate={handleUpdateBlock} />
                      ))}
                    </div>
                  )}
                  
                  {/* Generate more blocks button - centered beneath the blocks */}
                  {writingBlocks.length > 0 && currentTopic && (
                    <div className="flex justify-center mt-4 mb-4">
                      <button
                        onClick={handleGenerateMoreBlocks}
                        disabled={isGeneratingBlocks || !openaiConnected}
                        className="bg-[rgba(246,246,246,1)] hover:bg-gray-200 text-gray-700 px-4 py-2 rounded border border-gray-300 transition-colors disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed font-['Chivo:Regular',_sans-serif] text-[10px]"
                        title="Generate 8 additional blocks for the same topic"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] text-[rgba(255,255,255,1)]">➕</span>
                          <span className="text-[11px] text-left font-bold text-[rgba(77,77,77,1)]">Generate more</span>
                        </div>
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* Show spinner when generating additional blocks (underneath existing blocks) */}
              {isGeneratingBlocks && writingBlocks.length > 0 && (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner message="Generating more blocks..." />
                </div>
              )}

              {/* Show full loading state only when no blocks exist */}
              {isGeneratingBlocks && writingBlocks.length === 0 && (
                <div className="flex items-center justify-center py-12">
                  <LoadingSpinner message={`Generating blocks for "${currentTopic}"...`} />
                </div>
              )}
            </div>
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-2 gap-8">
            {/* Left Column - Text Editor and Develop Button */}
            <div>
              <h4 className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000] mb-3">
                Your Writing Draft
              </h4>
              <TextEditor
                droppedBlocks={droppedBlocks}
                onDrop={handleDrop}
                onMove={handleMove}
                onRemove={handleRemove}
                onTextChange={handleTextChange}
                customText={customText}
                onAddCustomBlock={handleAddCustomBlock}
                onUpdateDroppedBlock={handleUpdateDroppedBlock}
                generatingTitleForBlocks={generatingTitleForBlocks}
                onRegenerateBlock={handleRegenerateBlock}
                regeneratingBlocks={regeneratingBlocks}
              />
              <DevelopTextButton
                droppedBlocks={droppedBlocks}
                onDevelopText={handleDevelopText}
                isGenerating={isGenerating}
                openaiConnected={openaiConnected}
              />
            </div>

            {/* Right Column - Developed Text */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000]">
                  Developed Text
                </h4>
                {fullText && (
                  <div className="font-['Chivo:Regular',_sans-serif] text-[12px] text-[#666666]">
                    {fullText.trim().split(/\s+/).filter(word => word.length > 0).length} words
                  </div>
                )}
              </div>
              <DevelopedTextPanel
                fullText={fullText}
                onTextChange={handleFullTextChange}
                isGenerating={isGenerating}
              />
            </div>
          </div>
        </div>
        <div className="absolute border border-[#a8a8a8] border-solid inset-0 pointer-events-none rounded-[20px]" />
      </div>
    </DndProvider>
  );
}