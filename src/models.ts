export const MODELS = {
  chat: {
    flagship: "@cf/moonshotai/kimi-k2.7-code",
    reasoning: "@cf/deepseek-ai/deepseek-v4-pro-0813",
    fast: "@cf/deepseek-ai/deepseek-v4-flash-0731",
    coding: "@cf/zai-org/glm-5.2",
    general: "@cf/meta/llama-3.3-70b-instruct",
    lightweight: "@cf/meta/llama-3.1-8b-instruct-fast",
    vision: "@cf/qwen/qwen3.8-27b",
    mistralVision: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    nemotron: "@cf/nvidia/nemotron-3-120b-a12b",
    kimi26: "@cf/moonshotai/kimi-k2.6",
  },
  vision: { primary: "@cf/qwen/qwen3.8-27b", fast: "@cf/moondream3.1-9B-A2B", mistral: "@cf/mistralai/mistral-small-3.1-24b-instruct" },
  imageGen: { flagship: "@cf/blackforestlabs/flux-2-dev", fast: "@cf/blackforestlabs/flux-2-klein-4b", balanced: "@cf/blackforestlabs/flux-2-klein-9b", schnell: "@cf/blackforestlabs/flux-1-schnell", leonardo: "@cf/leonardo/lucid-origin", phoenix: "@cf/leonardo/phoenix-1.0" },
  stt: { batch: "@cf/deepgram/nova-3", realtime: "@cf/deepgram/flux" },
  tts: { en: "@cf/deepgram/aura-2-en", es: "@cf/deepgram/aura-2-es", multi: "@cf/myshell/melotts" },
  embeddings: { primary: "@cf/baai/bge-large-en-v1.5", japanese: "@cf/pfnet/plamo-embedding-1b" },
  translation: "@cf/meta/m2m100-1.2b",
  turnDetection: "@cf/pipecat-ai/smart-turn-v2",
} as const;

export const AGENT_MODELS = {
  nexus: { primary: MODELS.chat.flagship, fallback: MODELS.chat.nemotron, fast: MODELS.chat.fast },
  builder: { primary: MODELS.chat.coding, fallback: MODELS.chat.flagship, fast: MODELS.chat.fast },
  researcher: { primary: MODELS.chat.reasoning, fallback: MODELS.chat.flagship, fast: MODELS.chat.fast },
  creative: { primary: MODELS.chat.vision, fallback: MODELS.chat.mistralVision, fast: MODELS.chat.lightweight },
  analyst: { primary: MODELS.chat.reasoning, fallback: MODELS.chat.nemotron, fast: MODELS.chat.fast },
} as const;

export const EMBED_DIMENSIONS = 1024;
