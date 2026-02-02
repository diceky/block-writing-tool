
  # Prototyping Text with Blocks

  An AI-writing tool with a "prototyping" approach, where writers can plan their writing with bite-sized blocks, and iteratively develop the full text. The itial prototyping was conducted using Figma Make.

  ## Running the code

  1. Run `npm i` to install the dependencies.
  2. Make an `.env.local` file and add your Open AI API key as `OPENAI_API_KEY = xxxxxxxx`. Note that we don't need the `VITE_` prefix, since the key is used in Netlify Functions, and not in the Vite frontend (as it should be).
  3. This code uses Netlify Functions for the API calls, so `npm run dev` will not work. Instead, install [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/#run-builds-locally) and run `netlify dev`.
  
  ## Architecture

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Netlify Functions
- **AI Provider**: OpenAI GPT-4o models
- **Drag & Drop**: React DnD
- **Deployment**: Netlify

## API Functions

- `/.netlify/functions/chat-completion` - Main AI text generation
- `/.netlify/functions/models` - OpenAI connection testing