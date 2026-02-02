// @ts-nocheck
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { diff_match_patch, DIFF_INSERT, DIFF_DELETE } from 'diff-match-patch';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Settings, RotateCcw, Copy, Check } from 'lucide-react';
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
    //console.log('Raw OpenAI response:', content); // Debug logging
    
    // Extract JSON from the response
    content = extractJSON(content);
    //console.log('Extracted JSON:', content); // Debug logging

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

      // Calculate maxId from existing blocks
      const maxId = existingBlocks.length > 0 ? Math.max(...existingBlocks.map(block => block.id)) : 0;
      
      // Validate and sanitize each block
      return finalBlocks.map((block, index) => {
        if (!block || typeof block !== 'object') {
          console.warn(`Invalid block at index ${index}:`, block);
          return {
            id: maxId + index + 1,
            title: `Block ${maxId + index + 1}`,
            summary: `Content for block ${maxId + index + 1}`,
            source: 'generated',
            parentId: null,        // Add this
            children: [],          // Add this
          };
        }

        return {
          id: maxId + index + 1,
          title: (block.title || block.summary || `Block ${maxId + index + 1}`).toString().slice(0, 50),
          summary: (block.summary || block.description || block.content || 'No description provided').toString(),
          source: 'generated',
          parentId: null,          // Add this
          children: [],            // Add this
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

        // Calculate maxId here too
        const maxId = existingBlocks.length > 0 ? Math.max(...existingBlocks.map(block => block.id)) : 0;

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
    //console.log('Raw OpenAI response:', content); // Debug logging
    
    // Extract JSON from the response
    content = extractJSON(content);
    //console.log('Extracted JSON:', content); // Debug logging

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
            source: 'generated',
            parentId: null,
            children: [],
            isDeveloped: false, // Add flag to check if this block has already been developed
          };
        }
        
        return {
          id: maxId + index + 1,
          title: (block.title || block.summary || `Block ${maxId + index + 1}`).toString().slice(0, 50),
          summary: (block.summary || block.description || block.content || 'No description provided').toString(),
          source: 'generated',
          parentId: null,
          children: [],
          isDeveloped: false, // Add flag to check if this block has already been developed
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

async function expandTextWithOpenAI(blocks, topic, existingExpandedTextArray = [], onProgress) {
  // Get parent blocks for expansion
  const parentBlocks = blocks.filter(block => 
    block && (block.parentId === null || block.parentId === undefined)
  );
  
  const expandedParagraphs = [];
  // Iterate with index to map to existing expanded text array
  for (let i = 0; i < parentBlocks.length; i++) {
    const parent = parentBlocks[i];
    // Get children for this parent
    const children = blocks.filter(block => 
      block && block.parentId === parent.id
    );
    
    if (children.length > 0) {
      // Parent with children - create cohesive paragraph
      const allContent = [parent.summary, ...children.map(child => child.summary)];
      
      // Include only the current developed text for THIS parent block (if any)
      const currentExpandedText = Array.isArray(existingExpandedTextArray)
        ? (existingExpandedTextArray[i] || '')
        : '';
      const referenceTextSection = currentExpandedText && currentExpandedText.trim()
        ? `\n\nFor reference, this is the current developed text for this block (if any):\n${currentExpandedText.trim()}`
        : '';

      const prompt = `You are a clear and concise writer. 

Your goal is to write text that sounds natural to read out loud, using simple and direct language while staying polished and credible. 
Your task is to expand the following outline into a cohesive paragraph.

Topic sentence: ${parent.summary}
Supporting points: ${children.map(child => `- ${child.summary}`).join('\n')}

${referenceTextSection}

Instructions:
- Create a ${allContent.length * 1.5} sentence paragraph
- Start with the topic sentence, then expand each supporting point into 1-2 sentences
- Use plain, everyday English (aim for clarity, not elegance)
- Make it flow as one natural paragraph
- Stay consistent with the topic: ${topic}

Respond with only the expanded paragraph, no additional commentary or formatting.`;
      
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
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        } catch (_) {
          const errorText = await response.text();
          throw new Error(errorText || `HTTP error! status: ${response.status}`);
        }
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response format from OpenAI API');
      }

      const expansion = data.choices[0].message.content.trim();
      expandedParagraphs.push(expansion);
      if (typeof onProgress === 'function') {
        try { onProgress(i, expansion); } catch {}
      }
    } else {
      // Simple parent block - expand normally using existing function
      // Pass only the current developed text for this parent (if any)
      const currentExpandedText = Array.isArray(existingExpandedTextArray)
        ? (existingExpandedTextArray[i] || '')
        : '';
      const expansion = await regenerateSingleBlockExpansion(parent, topic, currentExpandedText);
      expandedParagraphs.push(expansion);
      if (typeof onProgress === 'function') {
        try { onProgress(i, expansion); } catch {}
      }
    }
  }
  
  return expandedParagraphs;
}

// Regenerate expansion for a single block
// Optionally include the current expanded text for this block as reference
async function regenerateSingleBlockExpansion(block, topic, currentExpandedText = '') {

  // Create a prompt for expanding just one block

  const referenceSection = currentExpandedText && currentExpandedText.trim()
    ? `\n\nFor reference, this is the current text developed for this block (if any)::\n${currentExpandedText.trim()}`
    : '';

  const prompt = `You are a clear and concise writer. Your goal is to write text that sounds natural to read out loud, using simple and direct language while staying polished and credible. Your task is to expand the following outline point into 1–2 natural, readable sentences.

Each expansion should:
- Transform the basic point into professional, business language that is easy to read
- Stay consistent and coherent to the overall topic of the writing, which is ${topic}

Outline point to expand:
${block.summary}

${referenceSection}

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

  // Auto-resize function for textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (textarea && !isTitle) {
      textarea.style.height = 'auto';
      const newHeight = Math.max(textarea.scrollHeight, 32); // Minimum 2 lines
      textarea.style.height = `${newHeight}px`;
    }
  }, [isTitle]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      adjustTextareaHeight();
    }
  }, [isEditing, adjustTextareaHeight]);

  useEffect(() => {
    setEditValue(value);
    // Adjust height when value changes (important for displaying long text)
    if (!isEditing) {
      setTimeout(adjustTextareaHeight, 0);
    }
  }, [value, isEditing, adjustTextareaHeight]);

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
    if (e.key === 'Enter' && (isTitle || !e.shiftKey)) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [isTitle, handleSave, handleCancel]);

  const handleClick = useCallback(() => {
    if (!isEditing) {
      setIsEditing(true);
    }
  }, [isEditing]);

  const handleBlur = useCallback(() => {
    handleSave();
  }, [handleSave]);

  const handleChange = useCallback((e) => {
    setEditValue(e.target.value);
    adjustTextareaHeight();
  }, [adjustTextareaHeight]);

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
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className={`${className} w-full bg-white border border-blue-300 rounded px-1 -mx-1 resize-none overflow-hidden`}
          placeholder={placeholder}
          maxLength={maxLength}
          style={{ minHeight: '32px' }}
        />
      );
    }
  }

  return (
    <div
      onClick={handleClick}
      ref={inputRef}
      className={`${className} cursor-pointer hover:bg-gray-100 text-black rounded px-1 -mx-1 transition-colors whitespace-pre-wrap break-words`}
      title="Click to edit"
      style={!isTitle ? { minHeight: '32px' } : undefined}
    >
      {value || placeholder}
    </div>
  );
}

// Topic Input Component
const TopicInput = React.forwardRef(function TopicInput({ onGenerateBlocks, isGenerating, openaiConnected, mode, onTopicChange }, ref) {
  const [topic, setTopic] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea function
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const lineHeight = 24;
      const minHeight = lineHeight * 3;
      const newHeight = Math.max(textarea.scrollHeight, minHeight);
      textarea.style.height = `${newHeight}px`;
    }
  }, []);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }, [handleGenerate]);

  const handleChange = (e) => {
    setTopic(e.target.value);
    if (onTopicChange) onTopicChange(e.target.value);
    setTimeout(adjustTextareaHeight, 0);
  };

  const canGenerate = topic.trim() && !isGenerating;

  return (
    <div ref={ref} className="bg-[rgba(248,248,248,1)] rounded-lg p-4 mb-6">
      <h3 className="font-['Chivo:Bold',_sans-serif] text-[16px] text-[#000000] mb-3">
        {mode==="ai-only" ? "Generate Your Writing" : "Generate Writing Blocks for Your Topic"}
      </h3>
      
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block font-['Chivo:Regular',_sans-serif] text-[12px] text-[#666666] mb-1">
            {mode==="ai-only" ? "Write your prompt here" : "What would you like to write about?"}
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
          {isGenerating ? 'Generating...' : (mode==="ai-only" ? "Generate" : "Generate Blocks")}
        </button>
      </div>
      
      <div className="text-[11px] text-gray-600 font-['Chivo:Regular',_sans-serif] mt-2">
        {!openaiConnected && (
          <p className="text-orange-600">• Connect to OpenAI above to generate custom writing blocks</p>
        )}
      </div>
    </div>
  );
})

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

// Drop line indicator used in editor reordering
function DropLineIndicator({ isVisible, position }) {
  if (!isVisible) return null;
  const posClass = position === 'above' ? '-top-2' : '-bottom-2';
  return (
    <div className={`absolute ${posClass} left-0 right-0 h-[2px] z-20`}>
      <div className="h-[2px] bg-blue-500" />
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
function DroppedBlock({
  block,
  index,
  onMove,
  onRemove,
  draggedBlockId,
  onDragStart,
  onDragEnd,
  onUpdate,
  isGeneratingTitle,
  onRegenerate,
  isRegenerating,
  childBlocks = [],
  droppedBlocks
}) {
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

  // Helper function to check circular relationships (hoisted)
  function wouldCreateCircularRelation(draggedId, targetParentId) {
    if (!draggedId || !targetParentId) return false;
    let currentBlock = droppedBlocks.find(b => b && b.id === targetParentId);
    while (currentBlock && currentBlock.parentId) {
      if (currentBlock.parentId === draggedId) {
        return true;
      }
      currentBlock = droppedBlocks.find(b => b && b.id === currentBlock.parentId);
    }
    return false;
  }

  // Separate drop zones for reordering
  const [{ isOver: isOverTop }, dropTop] = useDrop({
    accept: 'dropped-block',
    drop: (draggedItem, monitor) => {
      const item = monitor.getItem();
      if (!item || item.id === block.id || item.source !== 'editor') return;
      const draggedBlock = droppedBlocks.find(b => b && b.id === item.id);
      if (!draggedBlock) return;
      // If same parent, or cross-hierarchy, delegate to onMove with IDs
      if ((draggedBlock.parentId && block.parentId && draggedBlock.parentId === block.parentId) ||
          (draggedBlock.parentId !== block.parentId)) {
        onMove(item, { ...block, source: 'editor' });
      } else {
        // Top-level reorder: place above target index
        onMove(item.index, index);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }) && monitor.getItem()?.source === 'editor',
    }),
  });

  const [{ isOver: isOverBottom }, dropBottom] = useDrop({
    accept: 'dropped-block',
    drop: (draggedItem, monitor) => {
      const item = monitor.getItem();
      if (!item || item.id === block.id || item.source !== 'editor') return;
      const draggedBlock = droppedBlocks.find(b => b && b.id === item.id);
      if (!draggedBlock) return;
      if ((draggedBlock.parentId && block.parentId && draggedBlock.parentId === block.parentId) ||
          (draggedBlock.parentId !== block.parentId)) {
        onMove(item, { ...block, source: 'editor' });
      } else {
        const targetIndex = index + 1;
        onMove(item.index, targetIndex);
      }
    },
    collect: (monitor) => ({
      isOver: monitor.isOver({ shallow: true }) && monitor.getItem()?.source === 'editor',
    }),
  });

  // Child drop zone
  const [{ isOver: isChildZoneOver }, childDrop] = useDrop({
    accept: ['block', 'dropped-block'],
    drop: (item, monitor) => {
      if (!monitor.didDrop()) {
        if (item.id === block.id) return;

        const draggedBlock = droppedBlocks.find(b => b && b.id === item.id);
        if (draggedBlock && draggedBlock.children && draggedBlock.children.length > 0) {
          console.warn('Cannot drop a parent block with children into a child zone');
          return;
        }

        if (!wouldCreateCircularRelation(item.id, block.id)) {
          onMove(item, { type: 'child-zone', parentId: block.id });
        }
      }
    },
    collect: (monitor) => {
      const draggedItem = monitor.getItem();
      const draggedBlock = draggedItem ? droppedBlocks.find(b => b && b.id === draggedItem.id) : null;

      return {
        isOver: monitor.isOver({ shallow: true }) &&
          draggedItem?.id !== block.id &&
          !wouldCreateCircularRelation(draggedItem?.id, block.id) &&
          !(draggedBlock && draggedBlock.children && draggedBlock.children.length > 0),
      };
    },
  });


  // State for hover tracking and expansion
  const [isHovered, setIsHovered] = useState(false);

  // Track when this block starts being dragged
  useEffect(() => {
    if (isDragging && draggedBlockId !== block.id) {
      onDragStart(block.id);
    }
  }, [isDragging, block.id, draggedBlockId, onDragStart]);

  // Use light orange for custom blocks, light purple for predefined blocks
  const bgColor = block.source === 'custom' ? 'bg-[#FFEDD8]' : 'bg-[#EDF2FB]';

  // Determine timeline stroke color
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
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Top drop zone for reordering */}
      <div
        ref={dropTop}
        className="absolute -top-2 left-0 right-0 h-4 z-20"
      />

      {/* Drop line indicators */}
      <DropLineIndicator isVisible={isOverTop && !isDragging} position="above" />

      {/* Timeline connector - adjust for hierarchy */}
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
      <div
        ref={drag}
        className={`${block.parentId ? 'ml-12' : 'ml-6'} ${bgColor} rounded mb-1 cursor-move relative z-10 flex`}
        style={{ opacity }}
      >
        {/* Number strip - only show for parent blocks */}
        {!block.parentId && (
          <div className="w-8 bg-gray-50 border-r border-gray-200 flex items-start justify-center pt-3 text-[10px] font-['Chivo:Regular',_sans-serif] text-gray-500 rounded-l">
            {droppedBlocks.filter(b => b && !b.parentId).findIndex(b => b.id === block.id) + 1}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 p-3">
          <div className="flex items-center gap-3">
            <DragHandle />

            <div className="flex-1">
              <div className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000] capitalize flex items-center gap-2">
                {!block.parentId && <span className="text-xs text-gray-500"></span>}
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

            {/* Existing buttons */}
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

      {/* Bottom drop zone for reordering */}
      <div
        ref={dropBottom}
        className="absolute -bottom-2 left-0 right-0 h-4 z-20"
      />

      <DropLineIndicator isVisible={isOverBottom && !isDragging} position="below" />

      {/* Dynamic drop zone - only appears when dragging over this parent */}
      {!block.parentId && (
        <>
          {/* Render child blocks first */}
          {childBlocks.map((childBlock) => {
            if (!childBlock) return null;
            const childIndex = droppedBlocks.findIndex(b => b && b.id === childBlock.id);
            if (childIndex === -1) return null;

            return (
              <DroppedBlock
                key={childBlock.id}
                block={childBlock}
                index={childIndex}
                droppedBlocks={droppedBlocks}
                onMove={onMove}
                onRemove={onRemove}
                onUpdate={onUpdate}
                draggedBlockId={draggedBlockId}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                isGeneratingTitle={isGeneratingTitle}
                onRegenerate={onRegenerate}
                isRegenerating={isRegenerating}
              />
            );
          })}

          {/* Dynamic drop zone - only appears when dragging valid blocks over this parent */}
          {draggedBlockId &&
            draggedBlockId !== block.id &&
            isChildZoneOver && (
              <div
                ref={childDrop}
                className="ml-12 min-h-[40px] border-2 border-dashed rounded transition-colors relative border-blue-400 bg-blue-50"
              >
                <div className="flex items-center justify-center h-[60px] text-blue-600 text-sm font-medium">
                  Drop supporting content here
                </div>
              </div>
            )}

          {/* Hidden drop zone for detecting hover (always present but invisible) */}
          {(!isChildZoneOver || draggedBlockId === block.id) && (
            <div
              ref={childDrop}
              className="ml-12 min-h-[10px] opacity-0 pointer-events-auto"
            />
          )}
        </>
      )}
    </div>
  );
}

// Text editing area with drop zone
const TextEditor = React.forwardRef(function TextEditor(
  { droppedBlocks, onDrop, onMove, onRemove, onTextChange, customText, onAddCustomBlock, onUpdateDroppedBlock, generatingTitleForBlocks, onRegenerateBlock, regeneratingBlocks },
  ref
) {
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

  // Get only parent blocks for rendering
  const parentBlocks = droppedBlocks.filter(block =>
    block && block.id && (block.parentId === null || block.parentId === undefined)
  );

  return (
    <div ref={ref} className="bg-[#ffffff] min-h-[400px] w-full border border-gray-200 rounded-lg">
      <div className="min-h-[400px] overflow-clip relative w-full">
        <div ref={drop} className={`p-6 rounded-lg min-h-[400px] ${isOver ? 'bg-blue-50 border-2 border-dashed border-blue-300' : ''}`}>
          <div className="space-y-4">
            {parentBlocks.map((parentBlock, index) => {
              // Get child blocks for this parent and sort them by the order they appear in the children array
              const childBlocks = parentBlock.children
                ? parentBlock.children
                  .map(childId => droppedBlocks.find(block => block && block.id === childId))
                  .filter(block => block !== undefined) // Remove any undefined blocks
                : droppedBlocks.filter(block => block && block.id && block.parentId === parentBlock.id);

              // ADD SAFETY CHECK FOR PARENT BLOCK INDEX
              const parentBlockIndex = droppedBlocks.findIndex(b => b && b.id === parentBlock.id);

              // Skip if parent block not found in main array
              if (parentBlockIndex === -1) return null;

              return (
                <DroppedBlock
                  key={`${parentBlock.id}-${index}`}
                  block={parentBlock}
                  index={parentBlockIndex}
                  childBlocks={childBlocks}
                  droppedBlocks={droppedBlocks}
                  onMove={onMove}
                  onRemove={onRemove}
                  draggedBlockId={draggedBlockId}
                  onDragStart={setDraggedBlockId}
                  onDragEnd={() => setDraggedBlockId(null)}
                  onUpdate={onUpdateDroppedBlock}
                  isGeneratingTitle={generatingTitleForBlocks.has(parentBlock.id)}
                  onRegenerate={onRegenerateBlock}
                  isRegenerating={regeneratingBlocks.has(parentBlockIndex)}
                />
              );
            })}

            {parentBlocks.length === 0 && (
              <div className="text-center text-gray-500 py-16">
                <p className="text-lg">Drop writing blocks here to start building your draft</p>
                <p className="text-sm mt-2">Or type manually below</p>
              </div>
            )}

            {/* Manual text input area - unchanged */}
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
});

// Developed Text Panel Component
const DevelopedTextPanel = React.forwardRef(function DevelopedTextPanel({ expandedTextArray, onTextChange, isGenerating }, ref) {
  const handleItemChange = useCallback((index, newValue) => {
    const newArray = [...expandedTextArray];
    newArray[index] = newValue;
    onTextChange(newArray);
  }, [expandedTextArray, onTextChange]);

  // Auto-resize textareas when content changes (including regeneration)
  useEffect(() => {
    // Small delay to ensure DOM is updated
    setTimeout(() => {
      const textareas = document.querySelectorAll('.developed-text-textarea');
      textareas.forEach(textarea => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
      });
    }, 0);
  }, [expandedTextArray]);

  if (expandedTextArray.length > 0) {
    return (
      <div ref={ref} className="border border-gray-200 rounded-lg bg-white min-h-[200px]">
        {isGenerating && (
          <div className="flex items-center justify-center py-3 border-b border-gray-200">
            <LoadingSpinner message="Developing text..." />
          </div>
        )}
        {expandedTextArray.map((item, index) => (
          <div key={index} className="flex border-b border-gray-200 last:border-b-0">
            {/* Number strip */}
            <div className="w-8 bg-gray-50 border-r border-gray-200 flex items-start justify-center p-2 text-[10px] font-['Chivo:Regular',_sans-serif] text-gray-500">
              {index + 1}
            </div>

            {/* Text content */}
            <textarea
              value={item}
              onChange={(e) => handleItemChange(index, e.target.value)}
              className={`developed-text-textarea flex-1 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 font-['Chivo:Regular',_sans-serif] text-[14px] leading-6 bg-white transition-all duration-300 overflow-hidden ${(isGenerating && !(item && item.toString().trim().length > 0)) ? 'blur-sm opacity-75' : ''}`}
              style={{
                minHeight: '60px',
                height: 'auto',
                resize: 'none'
              }}
              placeholder={`Expanded text for block ${index + 1}...`}
              disabled={isGenerating}
              onInput={(e) => {
                // Additional resize on input for real-time adjustment
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="bg-[#ffffff] min-h-[400px] w-full border border-gray-200 rounded-lg">
      {isGenerating ? (
        <div className="flex items-center justify-center h-[400px] p-8">
          <LoadingSpinner message="Developing text..." />
        </div>
      ) : (
        <div className="flex items-center justify-center h-[400px] p-8 text-center">
          <p className="text-gray-500">
            Click "Develop full text" in the left panel to generate your expanded text here.
          </p>
        </div>
      )}
    </div>
  );
});

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

// Develop Text Button (matches previous layout styles)
function DevelopTextButton({ droppedBlocks, onDevelopText, isGenerating, openaiConnected }) {
  const canDevelop = droppedBlocks.filter(b => b && !b.parentId).length > 0;
  return (
    <div className="mt-4">
      <button
        onClick={onDevelopText}
        disabled={isGenerating || !openaiConnected || !canDevelop}
        className="bg-[#1b00b6] text-white px-5 py-2.5 rounded hover:bg-blue-800 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-['Chivo:Bold',_sans-serif] text-[14px]"
      >
        {isGenerating ? 'Developing…' : 'Develop full text'}
      </button>
    </div>
  );
}

export default function App() {
  const [droppedBlocks, setDroppedBlocks] = useState([]);
  const [customText, setCustomText] = useState('');
  const [expandedTextArray, setExpandedTextArray] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [regeneratingBlocks, setRegeneratingBlocks] = useState(new Set());
  const [nextBlockId, setNextBlockId] = useState(1000);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  const [error, setError] = useState('');
  const [generatingTitleForBlocks, setGeneratingTitleForBlocks] = useState(new Set());
  const [writingBlocks, setWritingBlocks] = useState(DEFAULT_WRITING_BLOCKS);
  const [isGeneratingBlocks, setIsGeneratingBlocks] = useState(false);
  const [currentTopic, setCurrentTopic] = useState('');
  const [openaiConnected, setOpenaiConnected] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [writingMode, setWritingMode] = useState('block'); // 'block' | 'manual' | 'ai-only'
  const [manualText, setManualText] = useState('');
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  // Diff debug toggle and latest diffs (rolling 3)
  const [showDiffDebug, setShowDiffDebug] = useState(false);
  const [latestDiffs, setLatestDiffs] = useState([]);
  // Reorder debug toggle and latest reorders (rolling 3)
  const [showReorderDebug, setShowReorderDebug] = useState(false);
  const [latestReorders, setLatestReorders] = useState([]);

  // AOI refs
  const topicInputRef = useRef(null);
  const writingBlocksRef = useRef(null);
  const textEditorRef = useRef(null);
  const developedPanelRef = useRef(null);
  const manualTextareaRef = useRef(null);

  // AOI logs
  const aoiLogsRef = useRef([]);
  const sessionIdRef = useRef(`session-${Date.now()}`);

  // TEXT_DIFF tracking
  const prevTextsRef = useRef({
    TopicInput: '',
    TextEditor: {},
    DevelopedTextPanel: {},
    ManualTextarea: ''
  });
  const diffTimersRef = useRef({});

  const tokenize = useCallback((s) => {
    if (!s) return [];
    return s.toString().trim().split(/\s+/).filter(Boolean);
  }, []);

  const dmpRef = useRef<diff_match_patch | null>(null);

  useEffect(() => {
    dmpRef.current = new diff_match_patch();
  }, []);

  // AI-only mode should rewrite the first block only.
  // If multiple items appear due to appending, keep only the latest.
  useEffect(() => {
    if (writingMode === 'ai-only' && Array.isArray(expandedTextArray) && expandedTextArray.length > 1) {
      const latest = expandedTextArray[expandedTextArray.length - 1];
      setExpandedTextArray([latest]);
    }
  }, [expandedTextArray, writingMode]);

  // Conversational continuity settings for AI-only mode
  const MAX_HISTORY_TOKENS = 3000; // approx cap for prior assistant outputs

  const buildMessagesForAIOnly = useCallback((prompt: string, historyText: string[]) => {
    const system = {
      role: 'system',
      content: 'You are a clear, concise writing assistant. Continue the conversation naturally in plain, everyday English.'
    };

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [system];

    // Add recent assistant outputs (most recent last), truncated by rough token estimate
    let tokenEstimate = 0;
    const startIdx = Math.max(0, historyText.length - 10);
    for (let i = startIdx; i < historyText.length; i++) {
      const content = (historyText[i] || '').toString();
      const words = content.trim().split(/\s+/).filter(Boolean).length;
      const approxTokens = Math.round(words * 1.3);
      if (tokenEstimate + approxTokens > MAX_HISTORY_TOKENS) break;
      messages.push({ role: 'assistant', content });
      tokenEstimate += approxTokens;
    }

    messages.push({ role: 'user', content: prompt });
    return messages;
  }, []);

  

  const dmpDiffCounts = useCallback((prev, curr) => {
    const dmp = dmpRef.current;
    if (!dmp) return { addedWords: 0, removedWords: 0 };
    const diffs = dmp.diff_main((prev || '').toString(), (curr || '').toString());
    dmp.diff_cleanupSemantic(diffs);
    let added = 0, removed = 0;
    for (const [op, text] of diffs) {
      if (op === DIFF_INSERT) added += tokenize(text).length;
      else if (op === DIFF_DELETE) removed += tokenize(text).length;
    }
    return { addedWords: added, removedWords: removed };
  }, [tokenize]);

  const logTextDiff = useCallback(({ location, by, addedWords, removedWords, targetId, blockId = null, indexId = null, editType = null }) => {
    if (!loggingEnabled) return;
    const entry = {
      type: 'TEXT_DIFF',
      ts: Date.now(),
      sessionId: sessionIdRef.current,
      writingMode,
      location,
      by,
      addedWords,
      removedWords,
      targetId,
      blockId,
      indexId,
    };
    if (editType) {
      entry.editType = editType;
    }
    aoiLogsRef.current.push(entry);
  }, [writingMode, loggingEnabled]);

  const scheduleDebouncedDiff = useCallback((key, prevText, currText, location, by, targetId, delay = 800, options = {}) => {
    if (by === 'ai') {
      const { addedWords, removedWords } = dmpDiffCounts(prevText, currText);
      if (loggingEnabled && (addedWords || removedWords)) {
        logTextDiff({ location, by, addedWords, removedWords, targetId, blockId: options?.blockId ?? null, indexId: options?.indexId ?? null, editType: options?.editType ?? null });
        setLatestDiffs(prev => [{ location, by, targetId, blockId: options?.blockId ?? null, indexId: options?.indexId ?? null, prevText: prevText || '', currText: currText || '', addedWords, removedWords }, ...prev].slice(0, 3));
      }
      if (location === 'TopicInput') prevTextsRef.current.TopicInput = currText || '';
      if (location === 'TextEditor' && targetId != null) {
        const storeKey = options?.storeKey ?? targetId;
        prevTextsRef.current.TextEditor[storeKey] = currText || '';
      }
      if (location === 'DevelopedTextPanel' && options?.storeKey != null) {
        prevTextsRef.current.DevelopedTextPanel[options.storeKey] = currText || '';
      }
      if (location === 'ManualTextarea') prevTextsRef.current.ManualTextarea = currText || '';
      return;
    }

    if (diffTimersRef.current[key]) clearTimeout(diffTimersRef.current[key]);
    diffTimersRef.current[key] = window.setTimeout(() => {
      const { addedWords, removedWords } = dmpDiffCounts(prevText, currText);
      if (loggingEnabled && (addedWords || removedWords)) {
        logTextDiff({ location, by, addedWords, removedWords, targetId, blockId: options?.blockId ?? null, indexId: options?.indexId ?? null, editType: options?.editType ?? null });
        setLatestDiffs(prev => [{ location, by, targetId, blockId: options?.blockId ?? null, indexId: options?.indexId ?? null, prevText: prevText || '', currText: currText || '', addedWords, removedWords }, ...prev].slice(0, 3));
        if (location === 'TopicInput') prevTextsRef.current.TopicInput = currText || '';
        if (location === 'TextEditor' && targetId != null) {
          const storeKey = options?.storeKey ?? targetId;
          prevTextsRef.current.TextEditor[storeKey] = currText || '';
        }
        if (location === 'DevelopedTextPanel' && options?.storeKey != null) {
          prevTextsRef.current.DevelopedTextPanel[options.storeKey] = currText || '';
        }
        if (location === 'ManualTextarea') prevTextsRef.current.ManualTextarea = currText || '';
      }
      delete diffTimersRef.current[key];
    }, delay);
  }, [dmpDiffCounts, logTextDiff, tokenize, loggingEnabled]);

  // BLOCK_MOVE logging helper
  const logBlockMove = useCallback((info) => {
    if (!loggingEnabled) return;
    const entry = {
      type: 'BLOCK_REORDER',
      ts: Date.now(),
      sessionId: sessionIdRef.current,
      writingMode,
      location: 'TextEditor',
      ...info,
    };
    aoiLogsRef.current.push(entry);
    setLatestReorders(prev => [entry, ...prev].slice(0, 3));
  }, [writingMode, loggingEnabled]);

  const getRectFromEl = useCallback((el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
  }, []);

  const buildAreas = useCallback(() => {
    const areas = {};
    if (writingMode === 'block') {
      const topic = getRectFromEl(topicInputRef.current);
      const grid = getRectFromEl(writingBlocksRef.current);
      const editor = getRectFromEl(textEditorRef.current);
      const dev = getRectFromEl(developedPanelRef.current);
      if (topic) areas.TopicInput = topic;
      if (grid) areas.WritingBlock = grid; // match requested name
      if (editor) areas.TextEditor = editor;
      if (dev) areas.DevelopedTextPanel = dev;
    } else if (writingMode === 'ai-only') {
      const topic = getRectFromEl(topicInputRef.current);
      const dev = getRectFromEl(developedPanelRef.current);
      if (topic) areas.TopicInput = topic;
      if (dev) areas.DevelopedTextPanel = dev;
    } else if (writingMode === 'manual') {
      const manual = getRectFromEl(manualTextareaRef.current);
      if (manual) areas.ManualTextarea = manual;
    }
    return areas;
  }, [getRectFromEl, writingMode]);

  const logAOIEntry = useCallback((reason = 'heartbeat') => {
    if (!loggingEnabled) return;
    const entry = {
      ts: Date.now(),
      sessionId: sessionIdRef.current,
      type: 'AOI',
      reason,
      writingMode,
      window: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        dpr: window.devicePixelRatio,
      },
      areas: buildAreas(),
    };
    aoiLogsRef.current.push(entry);
  }, [buildAreas, writingMode, loggingEnabled]);

  // Scroll/resize listeners + heartbeat
  useEffect(() => {
    if (!loggingEnabled) return;
    const onScroll = () => logAOIEntry('scroll');
    const onResize = () => logAOIEntry('resize');

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    const hb = setInterval(() => logAOIEntry('heartbeat'), 500);

    // Initial capture
    setTimeout(() => logAOIEntry('init'), 0);

    return () => {
      clearInterval(hb);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [logAOIEntry, loggingEnabled]);

  // Layout-change via ResizeObserver on relevant AOIs
  useEffect(() => {
    if (!loggingEnabled) return;
    const observers = [];

    const observeEl = (el) => {
      if (!el || typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => logAOIEntry('layout-change'));
      ro.observe(el);
      observers.push(ro);
    };

    if (writingMode === 'block') {
      observeEl(topicInputRef.current);
      observeEl(writingBlocksRef.current);
      observeEl(textEditorRef.current);
      observeEl(developedPanelRef.current);
    } else if (writingMode === 'ai-only') {
      observeEl(topicInputRef.current);
      observeEl(developedPanelRef.current);
    } else if (writingMode === 'manual') {
      observeEl(manualTextareaRef.current);
    }

    // Log immediately when mode or dependencies change
    logAOIEntry('mode-or-content-change');

    return () => {
      observers.forEach(o => o.disconnect());
    };
  }, [
    loggingEnabled,
    writingMode,
    writingBlocks.length,
    droppedBlocks.length,
    expandedTextArray.length,
    logAOIEntry,
  ]);

  const handleDownloadAOILog = useCallback(() => {
    // Set filename using Brisbane, Australia time (UTC+10)
    const brisbaneTime = new Date().toLocaleString('sv-SE', { timeZone: 'Australia/Brisbane' }).replace(' ', 'T');
    const filename = `log_${brisbaneTime.replace(/[:.]/g, '-')}.json`;
    const blob = new Blob([JSON.stringify(aoiLogsRef.current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  // Auto-connect when app loads
  useEffect(() => {
    const autoConnect = async () => {
      try {
        await testOpenAIConnection();
        setOpenaiConnected(true);
      } catch (error) {
        console.warn('Auto-connection failed:', error.message);
        setShowSettings(true);
      }
    };
    autoConnect();
  }, []);

  // React to logging toggle: download when turning off, reset debug toggles
  useEffect(() => {
    if (!loggingEnabled) {
      // Hide debug panels when logging stops
      setShowDiffDebug(false);
      setShowReorderDebug(false);
      // Auto-download the current JSON log
      if (aoiLogsRef.current.length > 0) {
        handleDownloadAOILog();
      }
    }
  }, [loggingEnabled, handleDownloadAOILog]);

  // Add handler for AI-only mode
  const handleAIOnlyGenerate = useCallback(async (prompt) => {
    if (!openaiConnected) {
      setError('Please connect to OpenAI in the settings above.');
      return;
    }
    
    setIsGenerating(true);
    setError('');
    
    try {
      // Build conversational messages using prior AI responses for continuity
      const messages = buildMessagesForAIOnly(prompt, expandedTextArray);

      const promptWithReference = `${prompt}
      
      For reference, this is the current text developed so far (if any):
      ${expandedTextArray.join('\n\n')}`;

      const response = await fetch('/.netlify/functions/chat-completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          // Keep backward compatibility with server expecting `prompt`
          prompt: promptWithReference,
          // Also send messages for continuity if server supports it
          messages,
          maxTokens: 4000,
          temperature: 0.7
        }),
      });

      if (!response.ok) {
        try {
          const errorData = await response.json();
          throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        } catch (_) {
          const errorText = await response.text();
          throw new Error(errorText || `HTTP error! status: ${response.status}`);
        }
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response format from OpenAI API');
      }

      const aiResponse = (data.choices?.[0]?.message?.content || '').trim();
      const prev = prevTextsRef.current.DevelopedTextPanel['ai-only-0'] || '';
      scheduleDebouncedDiff(`DP-0-ai`, prev, aiResponse, 'DevelopedTextPanel', 'ai', 1, 0, { storeKey: 'ai-only-0', blockId: null, indexId: 0, editType: 'generate-text' });
      // Append to history for future continuity
      setExpandedTextArray(prevArr => [...prevArr, aiResponse]);
    } catch (error) {
      console.error('Error generating AI response:', error);
      setError(`Failed to generate response: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [openaiConnected, scheduleDebouncedDiff, buildMessagesForAIOnly, expandedTextArray]);

  // Helper functions to work with hierarchy
  const getParentBlocks = useCallback(() => {
    return droppedBlocks.filter(block =>
      block && (block.parentId === null || block.parentId === undefined)
    );
  }, [droppedBlocks]);

  const getChildBlocks = useCallback((parentId) => {
    return droppedBlocks.filter(block =>
      block && block.parentId === parentId
    );
  }, [droppedBlocks]);

  const getBlockWithChildren = useCallback((parentBlock) => {
    const children = getChildBlocks(parentBlock.id);
    return {
      ...parentBlock,
      childBlocks: children
    };
  }, [getChildBlocks]);

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
    try {
      const id = updatedBlock?.id;
      if (id != null) {
        const prev = prevTextsRef.current.TextEditor[id] || '';
        const curr = (updatedBlock.summary || '').toString();
        scheduleDebouncedDiff(`TE-${id}-human`, prev, curr, 'TextEditor', 'human', id + 1, undefined, { storeKey: id, blockId: id, indexId: null, editType: 'edit-existing' });
      }
    } catch {}
    setDroppedBlocks(prev => prev.map((block, i) => 
      i === index ? updatedBlock : block
    ));
  }, [scheduleDebouncedDiff]);

  const handleDrop = useCallback((item, dropTarget = null) => {
    const newBlock = {
      ...item,
      id: item.id || Date.now(),
      parentId: dropTarget?.type === 'child-zone' ? dropTarget.parentId : null,
      children: [],
      isDeveloped: false, // Add flag to check if this block has already been developed
    };

    // Log AI diff for the dropped block's summary into TextEditor
    try {
      const curr = (newBlock.summary || '').toString();
      const prev = prevTextsRef.current.TextEditor[newBlock.id] || '';
      scheduleDebouncedDiff(`TE-${newBlock.id}-ai`, prev, curr, 'TextEditor', 'ai', newBlock.id + 1, 0, { storeKey: newBlock.id, blockId: newBlock.id, indexId: null, editType: 'new-dropped' });
    } catch {}

    setDroppedBlocks(prev => {
      const updated = [...prev, newBlock];

      // If dropped as child, update parent's children array
      if (newBlock.parentId) {
        return updated.map(block =>
          block.id === newBlock.parentId
            ? { ...block, children: [...(block.children || []), newBlock.id] }
            : block
        );
      }

      return updated;
    });
  }, [scheduleDebouncedDiff]);

  const handleMove = useCallback((draggedItem, dropTarget) => {
    if (typeof draggedItem === 'number' && typeof dropTarget === 'number') {
      // Top-level reorder
      setDroppedBlocks(prev => {
        const updated = [...prev];
        const draggedBlock = updated[draggedItem];
        const targetBlock = updated[dropTarget];
        if (draggedBlock && targetBlock && !draggedBlock.parentId && !targetBlock.parentId) {
          const [removedBlock] = updated.splice(draggedItem, 1);
          updated.splice(dropTarget, 0, removedBlock);
          logBlockMove({
            moveType: 'reorder-top-level',
            draggedBlockId: draggedBlock.id,
            targetBlockId: targetBlock.id,
            oldParentId: null,
            newParentId: null
          });
        }
        return updated.filter(b => b != null);
      });
    } else if (dropTarget?.type === 'child-zone') {
      // Move into child zone (become child)
      setDroppedBlocks(prev => {
        const updated = [...prev];
        const draggedBlock = updated.find(b => b && b.id === draggedItem.id);
        if (!draggedBlock) return prev;
        const oldParentId = draggedBlock.parentId || null;
        // Prevent moving parent with children
        if (!draggedBlock.parentId && draggedBlock.children && draggedBlock.children.length > 0) {
          console.warn('Cannot move a parent block with children into a child zone');
          return prev;
        }
        if (draggedBlock.parentId) {
          const oldParent = updated.find(b => b && b.id === draggedBlock.parentId);
          if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter(id => id !== draggedBlock.id);
          }
        }
        draggedBlock.parentId = dropTarget.parentId;
        const newParent = updated.find(b => b && b.id === dropTarget.parentId);
        if (newParent) {
          if (!newParent.children) newParent.children = [];
          if (!newParent.children.includes(draggedBlock.id)) {
            newParent.children.push(draggedBlock.id);
          }
        }
        logBlockMove({
          moveType: oldParentId === null ? 'demote-to-child' : 'child-reassign',
          draggedBlockId: draggedBlock.id,
          targetBlockId: dropTarget.parentId,
          oldParentId,
          newParentId: dropTarget.parentId
        });
        return updated.filter(b => b != null);
      });
    } else if (draggedItem.id && dropTarget.id && dropTarget.source === 'editor') {
      setDroppedBlocks(prev => {
        const updated = [...prev];
        const draggedBlock = updated.find(b => b && b.id === draggedItem.id);
        const targetBlock = updated.find(b => b && b.id === dropTarget.id);
        if (!draggedBlock || !targetBlock) return prev.filter(b => b != null);
        const oldParentId = draggedBlock.parentId || null;
        let moveType = 'unknown';

        if (draggedBlock.parentId && draggedBlock.parentId === targetBlock.parentId) {
          // Reorder children
          const parent = updated.find(b => b && b.id === draggedBlock.parentId);
            if (parent && parent.children) {
              const draggedIndex = parent.children.indexOf(draggedBlock.id);
              const targetIndex = parent.children.indexOf(targetBlock.id);
              if (draggedIndex !== -1 && targetIndex !== -1 && draggedIndex !== targetIndex) {
                parent.children.splice(draggedIndex, 1);
                parent.children.splice(targetIndex, 0, draggedBlock.id);
                moveType = 'reorder-children';
              }
            }
        } else if (draggedBlock.parentId && !targetBlock.parentId) {
          // Promote child to top-level
          const oldParent = updated.find(b => b && b.id === draggedBlock.parentId);
          if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter(id => id !== draggedBlock.id);
          }
          draggedBlock.parentId = null;
          const targetIndex = updated.findIndex(b => b && b.id === targetBlock.id);
          if (targetIndex !== -1) {
            const draggedIndex = updated.findIndex(b => b && b.id === draggedBlock.id);
            if (draggedIndex !== -1) {
              updated.splice(draggedIndex, 1);
              const newTargetIndex = draggedIndex < targetIndex ? targetIndex : targetIndex + 1;
              updated.splice(newTargetIndex, 0, draggedBlock);
            }
          }
          moveType = 'promote-child';
        } else if (!draggedBlock.parentId && targetBlock.parentId) {
          // Demote top-level to child
          if (draggedBlock.children && draggedBlock.children.length > 0) {
            console.warn('Cannot move a parent block with children to become a child');
            return prev.filter(b => b != null);
          }
          draggedBlock.parentId = targetBlock.parentId;
          const newParent = updated.find(b => b && b.id === targetBlock.parentId);
          if (newParent) {
            if (!newParent.children) newParent.children = [];
            const targetIndex = newParent.children.indexOf(targetBlock.id);
            if (targetIndex !== -1) {
              newParent.children.splice(targetIndex, 0, draggedBlock.id);
            } else {
              newParent.children.push(draggedBlock.id);
            }
          }
          moveType = 'demote-to-child';
        } else if (draggedBlock.parentId && targetBlock.parentId && draggedBlock.parentId !== targetBlock.parentId) {
          // Move child between parents
          const oldParent = updated.find(b => b && b.id === draggedBlock.parentId);
          if (oldParent && oldParent.children) {
            oldParent.children = oldParent.children.filter(id => id !== draggedBlock.id);
          }
          draggedBlock.parentId = targetBlock.parentId;
          const newParent = updated.find(b => b && b.id === targetBlock.parentId);
          if (newParent) {
            if (!newParent.children) newParent.children = [];
            const targetIndex = newParent.children.indexOf(targetBlock.id);
            if (targetIndex !== -1) {
              newParent.children.splice(targetIndex, 0, draggedBlock.id);
            } else {
              newParent.children.push(draggedBlock.id);
            }
          }
          moveType = 'move-between-parents';
        }

        logBlockMove({
          moveType,
          draggedBlockId: draggedBlock.id,
          targetBlockId: targetBlock.id,
          oldParentId,
          newParentId: draggedBlock.parentId || null
        });

        return updated.filter(b => b != null);
      });
    }
  }, [logBlockMove]);

  const handleRemove = useCallback((index) => {
    setDroppedBlocks(prev => {
      const updated = prev.filter((_, i) => i !== index);
      // Also clean up any undefined blocks
      return updated.filter(block => block != null);
    });
  }, []);

  const handleTextChange = useCallback((text) => {
    setCustomText(text);
  }, []);

  const handleAddCustomBlock = useCallback(async () => {
    if (!customText.trim()) return;
    
    const blockId = nextBlockId;
    const text = customText.trim();
    
    // Create block immediately with placeholder title
    const newBlock = {
      id: blockId,
      title: 'Generating title...',
      summary: text,
      source: 'custom',
      parentId: null,        // Add this
      children: [],          // Add this
      isDeveloped: false, // Add flag to check if this block has already been developed
    };
    
    // Add block to draft immediately
    setDroppedBlocks(prev => [...prev, newBlock]);
    setCustomText('');
    setNextBlockId(prev => prev + 1);
    // Log human diff for manual add (summary only)
    try {
      const prev = prevTextsRef.current.TextEditor[blockId] || '';
      scheduleDebouncedDiff(`TE-${blockId}-human-add`, prev, text, 'TextEditor', 'human', blockId + 1, undefined, { storeKey: blockId, blockId, indexId: null, editType: 'new-custom' });
    } catch {}
    
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
  }, [customText, nextBlockId, openaiConnected, scheduleDebouncedDiff]);

  const handleDevelopText = useCallback(async () => {
    if (!openaiConnected) {
      setError('Please connect to OpenAI in the settings above to develop text.');
      return;
    }
    
    setIsGenerating(true);
    setError('');
    
    try {
      // Prepare array length to show placeholders and enable progressive updates
      const parentBlocksInit = droppedBlocks.filter(block =>
        block && (block.parentId === null || block.parentId === undefined)
      );
      // Initialize array to correct length for progressive fill
      setExpandedTextArray(prev => {
        const next = [...prev];
        while (next.length < parentBlocksInit.length) next.push('');
        if (next.length > parentBlocksInit.length) next.splice(parentBlocksInit.length);
        return next;
      });

      const expanded = await expandTextWithOpenAI(
        droppedBlocks,
        currentTopic,
        expandedTextArray,
        (index, text) => {
          // Update UI as each block finishes
          setExpandedTextArray(prev => {
            const next = [...prev];
            // Ensure array length
            while (next.length <= index) next.push('');
            next[index] = text;
            return next;
          });
        }
      );
      const parentBlocks = droppedBlocks.filter(block =>
        block && (block.parentId === null || block.parentId === undefined)
      );
      // Log AI diffs per paragraph (include blockId and indexId)
      (expanded || []).forEach((p, i) => {
        const parentId = parentBlocks[i]?.id ?? null;
        const prev = parentId != null ? (prevTextsRef.current.DevelopedTextPanel[parentId] || '') : '';
        const curr = (p || '').toString();
        scheduleDebouncedDiff(`DP-${parentId ?? i}-ai`, prev, curr, 'DevelopedTextPanel', 'ai', i + 1, 0, { storeKey: parentId, blockId: parentId, indexId: i, editType: 'develop-full-text' });
      });
      // In AI-only mode, rewrite the first block only
      if (writingMode === 'ai-only') {
        const next = [...expandedTextArray];
        const newParagraph = expanded?.[0] || '';
        if (next.length === 0) {
          setExpandedTextArray([newParagraph]);
        } else {
          next[0] = newParagraph;
          setExpandedTextArray(next);
        }
      } else {
        setExpandedTextArray(expanded);
      }

      // Mark all parent blocks as developed
      setDroppedBlocks(prev => prev.map(block => {
        if (block && (block.parentId === null || block.parentId === undefined)) {
          return { ...block, isDeveloped: true };
        }
        return block;
      }));
    } catch (error) {
      console.error('Error developing text:', error);
      setError(`Failed to develop text: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  }, [droppedBlocks, openaiConnected, currentTopic, scheduleDebouncedDiff]);

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

    // Determine which block index should show the animation
    let animationBlockIndex = blockIndex;

    // If this is a child block, find the parent's index for animation
    if (blockToRegenerate.parentId) {
      const parentIndex = droppedBlocks.findIndex(block =>
        block && block.id === blockToRegenerate.parentId
      );
      if (parentIndex !== -1) {
        animationBlockIndex = parentIndex;
      }
    }

    // Add block to regenerating set (use the animation block index)
    setRegeneratingBlocks(prev => new Set([...prev, animationBlockIndex]));
    setError('');

    try {
      let newExpansion;
      let parentBlockForRegeneration = null;
      let childBlocksForRegeneration = [];

      // Determine which parent+children combination to regenerate
      if (!blockToRegenerate.parentId) {
        // This is a parent block - regenerate it with its children
        parentBlockForRegeneration = blockToRegenerate;
        childBlocksForRegeneration = droppedBlocks.filter(block =>
          block && block.parentId === blockToRegenerate.id
        );
      } else {
        // This is a child block - find its parent and regenerate the parent+children combination
        parentBlockForRegeneration = droppedBlocks.find(block =>
          block && block.id === blockToRegenerate.parentId
        );
        childBlocksForRegeneration = droppedBlocks.filter(block =>
          block && block.parentId === blockToRegenerate.parentId
        );
      }

      // Check if we should regenerate as a cohesive paragraph (parent with children)
      if (parentBlockForRegeneration && childBlocksForRegeneration.length > 0) {
        // Regenerate as cohesive paragraph
        const allContent = [parentBlockForRegeneration.summary, ...childBlocksForRegeneration.map(child => child.summary)];

        // Include only the current developed text for this parent block (if any), not the full text
        const parentBlocksForIndex = droppedBlocks.filter(block =>
          block && (block.parentId === null || block.parentId === undefined)
        );
        const expandedTextIndexRef = parentBlocksForIndex.findIndex(block => block.id === parentBlockForRegeneration.id);
        const currentExpandedTextForParent = expandedTextIndexRef !== -1 ? (expandedTextArray[expandedTextIndexRef] || '') : '';
        const referenceSection = currentExpandedTextForParent && currentExpandedTextForParent.trim()
          ? `\n\nFor reference, this is the current developed text for this block (if any):\n${currentExpandedTextForParent.trim()}`
          : '';

        const prompt = `You are a clear and concise writer. Your goal is to write text that sounds natural to read out loud, using simple and direct language while staying polished and credible. Your task is to expand the following outline into a cohesive paragraph.

Topic sentence: ${parentBlockForRegeneration.summary}
Supporting points: ${childBlocksForRegeneration.map(child => `- ${child.summary}`).join('\n')}

      ${referenceSection}

Instructions:
- Create a ${allContent.length * 1.5} sentence paragraph
- Start with the topic sentence, then expand each supporting point into 1-2 sentences
- Use plain, everyday English (aim for clarity, not elegance)
- Make it flow as one natural paragraph
- Stay consistent with the topic: ${currentTopic}

Respond with only the expanded paragraph, no additional commentary or formatting.`;

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

        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
          throw new Error('Invalid response format from OpenAI API');
        }

        newExpansion = data.choices[0].message.content.trim();
      } else {
        // This is a simple parent block without children - use single block regeneration
        // Pass the current expanded paragraph for this block (if any) as reference
        const parentBlocksForIndex = droppedBlocks.filter(block =>
          block && (block.parentId === null || block.parentId === undefined)
        );
        const expandedTextIndexRef = parentBlocksForIndex.findIndex(block => block.id === blockToRegenerate.id);
        const currentExpandedText = expandedTextIndexRef !== -1 ? (expandedTextArray[expandedTextIndexRef] || '') : '';
        newExpansion = await regenerateSingleBlockExpansion(blockToRegenerate, currentTopic, currentExpandedText);
      }

      // Find the correct position in expandedTextArray
      const parentBlocks = droppedBlocks.filter(block =>
        block && (block.parentId === null || block.parentId === undefined)
      );

      // Always find the parent block's position in the expanded text array
      const targetParentBlock = parentBlockForRegeneration || blockToRegenerate;
      const expandedTextIndex = parentBlocks.findIndex(block => block.id === targetParentBlock.id);

      if (expandedTextIndex !== -1) {
        // For already-developed blocks, treat as a true replacement at the same index
        if (targetParentBlock.isDeveloped) {
          try {
            const prev = prevTextsRef.current.DevelopedTextPanel[targetParentBlock.id] || '';
            const curr = (newExpansion || '').toString();
            // Use DMP-based diff; no replace mode
            scheduleDebouncedDiff(`DP-${targetParentBlock.id}-ai-regen`, prev, curr, 'DevelopedTextPanel', 'ai', expandedTextIndex + 1, 0, { storeKey: targetParentBlock.id, blockId: targetParentBlock.id, indexId: expandedTextIndex, editType: 'regenerate-existing' });
          } catch {}
          // Block was already developed - UPDATE at the position
          setExpandedTextArray(prev => {
            const newArray = [...prev];
            // Ensure array is large enough
            while (newArray.length <= expandedTextIndex) {
              newArray.push('');
            }
            newArray[expandedTextIndex] = newExpansion;
            return newArray;
          });
        } else {
          // Block is NEW and hasn't been developed yet - INSERT at position
          // Log as a pure addition (no removals due to index shift)
          try {
            const prev = '';
            const curr = (newExpansion || '').toString();
            scheduleDebouncedDiff(`DP-${targetParentBlock.id}-ai-insert`, prev, curr, 'DevelopedTextPanel', 'ai', expandedTextIndex + 1, 0, { storeKey: targetParentBlock.id, blockId: targetParentBlock.id, indexId: expandedTextIndex, editType: 'regenerate-new' });
          } catch {}

          setExpandedTextArray(prev => {
            const newArray = [...prev];
            newArray.splice(expandedTextIndex, 0, newExpansion);
            return newArray;
          });

          // Align prevTexts indices to account for the insertion, so future diffs match positions
          // Store baseline under blockId; no index shifting needed anymore
          prevTextsRef.current.DevelopedTextPanel[targetParentBlock.id] = (newExpansion || '').toString();

          // Mark the block as developed
          setDroppedBlocks(prev => prev.map(block =>
            block.id === targetParentBlock.id ? { ...block, isDeveloped: true } : block
          ));
        }
      } else {
        console.warn('Could not find correct position for regenerated block');
      }

    } catch (error) {
      console.error('Error regenerating block:', error);
      setError(`Failed to regenerate block: ${error.message}`);
    } finally {
      // Remove block from regenerating set (use the animation block index)
      setRegeneratingBlocks(prev => {
        const newSet = new Set(prev);
        newSet.delete(animationBlockIndex);
        return newSet;
      });
    }
  }, [droppedBlocks, openaiConnected, currentTopic, scheduleDebouncedDiff]);

  const handleCopyToClipboard = useCallback(async () => {
    try {
      const text = expandedTextArray.join('\n\n').trim();
      if (!text) return;
      await navigator.clipboard.writeText(text);
      setCopiedToClipboard(true);
      setTimeout(() => setCopiedToClipboard(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setError('Failed to copy text to clipboard');
    }
  }, [expandedTextArray]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="bg-[#ffffff] relative rounded-[20px] size-full">
        <div className="overflow-auto relative size-full p-20">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="font-['Chivo:Bold',_sans-serif] not-italic text-[#000000] text-left text-[32px] mb-4">
              <p className="block leading-[normal]">Let's prototype your writing</p>
            </div>
            <div className="flex items-center gap-4">
              {/* Writing Mode Selector */}
              <div className="flex gap-2 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setWritingMode('block')}
                  className={`px-3 py-1.5 rounded text-[12px] font-['Chivo:Bold',_sans-serif] transition-colors ${writingMode === 'block'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  Block Mode
                </button>
                <button
                  onClick={() => setWritingMode('ai-only')}
                  className={`px-3 py-1.5 rounded text-[12px] font-['Chivo:Bold',_sans-serif] transition-colors ${writingMode === 'ai-only'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  AI Only
                </button>
                <button
                  onClick={() => setWritingMode('manual')}
                  className={`px-3 py-1.5 rounded text-[12px] font-['Chivo:Bold',_sans-serif] transition-colors ${writingMode === 'manual'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                    }`}
                >
                  Manual
                </button>
              </div>

              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-md transition-colors ${openaiConnected
                  ? 'text-green-600 hover:text-green-800 hover:bg-green-100'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'}`}
                title="Settings"
              >
                <Settings size={20} />
              </button>

              {/* Logging Toggle */}
              <button
                onClick={() => setLoggingEnabled(prev => !prev)}
                className={`px-3 py-1.5 rounded text-[12px] font-['Chivo:Bold',_sans-serif] ${loggingEnabled ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                title={loggingEnabled ? 'Stop logging' : 'Start logging'}
              >
                {loggingEnabled ? 'Stop Logging' : 'Start Logging'}
              </button>

              {loggingEnabled && (
                <>
                  <button
                    onClick={() => setShowDiffDebug(v => !v)}
                    className="px-3 py-1.5 rounded text-[12px] font-['Chivo:Bold',_sans-serif] bg-gray-100 hover:bg-gray-200 text-gray-700"
                    title="Toggle diff debug panel"
                  >
                    {showDiffDebug ? 'Hide Diff Debug' : 'Show Diff Debug'}
                  </button>
                  <button
                    onClick={() => setShowReorderDebug(v => !v)}
                    className="px-3 py-1.5 rounded text-[12px] font-['Chivo:Bold',_sans-serif] bg-gray-100 hover:bg-gray-200 text-gray-700"
                    title="Toggle reorder debug panel"
                  >
                    {showReorderDebug ? 'Hide Reorder Debug' : 'Show Reorder Debug'}
                  </button>
                </>
              )}
            </div>
          </div>

          {showDiffDebug && latestDiffs.length > 0 && (
            <div className="mb-6 border border-blue-200 bg-blue-50 text-blue-800 rounded p-4 text-sm">
              <div className="font-bold mb-2">Recent TEXT_DIFFs (last 3)</div>
              <div className="space-y-4">
                {latestDiffs.map((d, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-2 gap-3 border border-blue-100 rounded p-3 bg-white">
                    <div>
                      <div className="text-xs text-gray-600">Location / By / Target</div>
                      <div>{d.location} / {d.by} / {d.targetId}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600">IDs</div>
                      <div>Block ID: {d.blockId ?? '—'} · Index: {d.indexId ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600">Counts</div>
                      <div>Added: {d.addedWords} · Removed: {d.removedWords}</div>
                    </div>
                    <div className="md:col-span-1">
                      <div className="text-xs text-gray-600">Prev</div>
                      <pre className="whitespace-pre-wrap break-words bg-gray-50 border border-blue-100 rounded p-2 text-gray-900">{d.prevText}</pre>
                    </div>
                    <div className="md:col-span-1">
                      <div className="text-xs text-gray-600">Curr</div>
                      <pre className="whitespace-pre-wrap break-words bg-gray-50 border border-blue-100 rounded p-2 text-gray-900">{d.currText}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {showReorderDebug && latestReorders.length > 0 && (
            <div className="mb-6 border border-purple-200 bg-purple-50 text-purple-800 rounded p-4 text-sm">
              <div className="font-bold mb-2">Recent BLOCK_REORDERs (last 3)</div>
              <div className="space-y-3">
                {latestReorders.map((r, idx) => (
                  <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-3 border border-purple-100 rounded p-3 bg-white">
                    <div>
                      <div className="text-xs text-gray-600">Move Type</div>
                      <div>{r.moveType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600">Dragged / Target</div>
                      <div>{r.draggedBlockId} → {r.targetBlockId}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-600">Parent Change</div>
                      <div>{String(r.oldParentId)} → {String(r.newParentId)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6 text-sm">
              {error}
            </div>
          )}

          {/* Block Writing Mode */}
          {writingMode === 'block' && (
            <>
              <div className="space-y-6 mb-8">
                <TopicInput
                  ref={topicInputRef}
                  onGenerateBlocks={handleGenerateBlocks}
                  isGenerating={isGeneratingBlocks}
                  openaiConnected={openaiConnected}
                  mode="block"
                  onTopicChange={(text) => {
                    const prev = prevTextsRef.current.TopicInput || '';
                    scheduleDebouncedDiff('TopicInput', prev, (text || '').toString(), 'TopicInput', 'human', 'topic');
                  }}
                />

                <div className="w-full" ref={writingBlocksRef}>
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

                  {isGeneratingBlocks && writingBlocks.length > 0 && (
                    <div className="flex items-center justify-center py-8">
                      <LoadingSpinner message="Generating more blocks..." />
                    </div>
                  )}

                  {isGeneratingBlocks && writingBlocks.length === 0 && (
                    <div className="flex items-center justify-center py-12">
                      <LoadingSpinner message={`Generating blocks for "${currentTopic}"...`} />
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8">
                <div>
                  <h4 className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000] mb-3">
                    Your Writing Draft
                  </h4>
                  <TextEditor
                    ref={textEditorRef}
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

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000]">
                      Developed Text
                    </h4>
                    {expandedTextArray.length > 0 && (
                      <div className="flex items-center gap-2">
                        <div className="text-xs text-[#666]">
                          {expandedTextArray.join('\n\n').trim().split(/\s+/).filter(Boolean).length} words
                        </div>
                        <button
                          onClick={handleCopyToClipboard}
                          className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-600 hover:text-blue-600"
                          title="Copy to clipboard"
                        >
                          {copiedToClipboard ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                        </button>
                      </div>
                    )}
                  </div>
                  <DevelopedTextPanel
                    ref={developedPanelRef}
                    expandedTextArray={expandedTextArray}
                    onTextChange={(newArray) => {
                      (newArray || []).forEach((val, i) => {
                        const parentBlocks = droppedBlocks.filter(block =>
                          block && (block.parentId === null || block.parentId === undefined)
                        );
                        const parentId = parentBlocks[i]?.id ?? null;
                        const prev = parentId != null ? (prevTextsRef.current.DevelopedTextPanel[parentId] || '') : '';
                        const curr = (val || '').toString();
                        if (prev !== curr) {
                          scheduleDebouncedDiff(`DP-${parentId ?? i}-human`, prev, curr, 'DevelopedTextPanel', 'human', i + 1, undefined, { storeKey: parentId, blockId: parentId, indexId: i, editType: 'edit-existing' });
                        }
                      });
                      setExpandedTextArray(newArray);
                    }}
                    isGenerating={isGenerating}
                  />
                </div>
              </div>
            </>
          )}

          {/* Manual Mode */}
          {writingMode === 'manual' && (
            <div className="max-w-4xl mx-auto" >
              <div className="flex justify-between items-center mb-3">
                <h4 className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000]">
                  Manual Writing
                </h4>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-[#666]">
                    {manualText.trim().split(/\s+/).filter(Boolean).length} words
                  </div>
                  <button
                    onClick={async () => {
                      if (!manualText.trim()) return;
                      try {
                        await navigator.clipboard.writeText(manualText);
                        setCopiedToClipboard(true);
                        setTimeout(() => setCopiedToClipboard(false), 2000);
                      } catch (err) {
                        console.error('Failed to copy to clipboard:', err);
                        setError('Failed to copy text to clipboard');
                      }
                    }}
                    className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-600 hover:text-blue-600"
                    title="Copy to clipboard"
                  >
                    {copiedToClipboard ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
              <textarea
                ref={manualTextareaRef}
                value={manualText}
                onChange={(e) => {
                  const curr = (e.target.value || '').toString();
                  const prev = prevTextsRef.current.ManualTextarea || '';
                  // Log human diff in manual mode
                  scheduleDebouncedDiff('ManualTextarea', prev, curr, 'ManualTextarea', 'human', 'manual');
                  setManualText(curr);
                }}
                className="w-full min-h-[600px] p-6 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-[14px] leading-6"
                placeholder="Start writing your text here..."
              />
            </div>
          )}

          {/* AI-only Mode */}
          {writingMode === 'ai-only' && (
            <>
              <div className="mb-6">
                <TopicInput
                  ref={topicInputRef}
                  onGenerateBlocks={handleAIOnlyGenerate}
                  isGenerating={isGenerating}
                  openaiConnected={openaiConnected}
                  mode="ai-only"
                  onTopicChange={(text) => {
                    const prev = prevTextsRef.current.TopicInput || '';
                    scheduleDebouncedDiff('TopicInput', prev, (text || '').toString(), 'TopicInput', 'human', 'topic');
                  }}
                />
              </div>
              <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-['Chivo:Bold',_sans-serif] text-[14px] text-[#000000]">AI Response</h4>
                  {expandedTextArray.length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-[#666]">
                        {expandedTextArray.join('\n\n').trim().split(/\s+/).filter(Boolean).length} words
                      </div>
                      <button
                        onClick={handleCopyToClipboard}
                        className="p-1.5 rounded hover:bg-gray-100 transition-colors text-gray-600 hover:text-blue-600"
                        title="Copy to clipboard"
                      >
                        {copiedToClipboard ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                      </button>
                    </div>
                  )}
                </div>
                <DevelopedTextPanel
                  ref={developedPanelRef}
                  expandedTextArray={expandedTextArray}
                  onTextChange={(newArray) => {
                    (newArray || []).forEach((val, i) => {
                      // In AI-only mode, there is no parentId; use a stable storeKey
                      const storeKey = 'ai-only-0';
                      const prev = prevTextsRef.current.DevelopedTextPanel[storeKey] || '';
                      const curr = (val || '').toString();
                      if (prev !== curr) {
                        scheduleDebouncedDiff(`DP-ai-only-${i}-human`, prev, curr, 'DevelopedTextPanel', 'human', i + 1, undefined, { storeKey, blockId: null, indexId: i, editType: 'edit-existing' });
                      }
                    });
                    setExpandedTextArray(newArray);
                  }}
                  isGenerating={isGenerating}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </DndProvider>
  );
}