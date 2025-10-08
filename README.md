
  # Prototyping Text with Blocks

  An AI-writing tool with a "prototyping" approach, where writers can plan their writing with bite-sized blocks, and iteratively develop the full text. The itial prototyping was conducted using [this Figma Make file](https://www.figma.com/design/36MbGRLYsSLj8t0hQbOGWA/Prototyping-Text-with-Blocks).

  ## Running the code

  Run `npm i` to install the dependencies.
  Run `npm run dev` to start the development server.
  
  ## Architecture

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Netlify Functions (serverless)
- **AI Provider**: OpenAI GPT-4o models
- **Drag & Drop**: React DnD
- **Deployment**: Netlify

## API Functions

- `/.netlify/functions/chat-completion` - Main AI text generation
- `/.netlify/functions/models` - OpenAI connection testing