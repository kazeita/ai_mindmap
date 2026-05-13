# Reasoning Map - AI Mindmap

An interactive diagnostic tool that helps you explore problems through an AI-powered reasoning map. Describe a problem, and the app generates diagnostic keywords that branch into deeper investigations.
Preview here: https://promes.vercel.app/
<img width="1412" height="858" alt="image" src="https://github.com/user-attachments/assets/8e2e5a31-8954-488b-aae4-f99629797c5e" />

## Features

- **Interactive Problem Mapping**: Describe any problem and explore it like a mind map
- **AI-Powered Diagnostics**: Uses Claude AI to generate contextual diagnostic keywords
- **Branch Exploration**: Dig deeper into specific diagnostic paths
- **Answer Insights**: Get AI-generated summaries of your investigation path and answers
- **Model Fallback**: Automatically switches between Claude Sonnet and Haiku models with rate-limit handling
- **Dark UI**: Modern, minimal design with smooth interactions

## Prerequisites

- Node.js 16+
- An Anthropic API key (for Claude access)

## Setup

1. Clone the repository:
```bash
git clone https://github.com/kazeita/ai_mindmap.git
cd ai_mindmap
```

2. Install dependencies:
```bash
npm install
```

3. Set up your Anthropic API key:
```bash
export ANTHROPIC_API_KEY="your-api-key-here"
```

4. Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## How to Use

1. **Describe a problem** in the input field
2. Click **"Map it"** to generate initial diagnostic keywords
3. **Branch** into any keyword to explore deeper
4. **Answer questions** to get AI insights about your investigation
5. **Eliminate** branches that don't apply
6. Use **"Start Over"** to begin a new problem

## Technical Details

- **Frontend**: React 18 with Hooks
- **Build Tool**: Vite
- **AI API**: Anthropic Claude API
- **Styling**: Inline CSS with custom fonts (Syne, DM Mono)

## Model Configuration

The app uses a priority list of models:
1. Claude Sonnet 4 (20250514)
2. Claude Haiku 4.5 (20251001)

It automatically falls back to the next model on rate limits or errors.

## License

MIT
