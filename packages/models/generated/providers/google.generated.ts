import type { GeneratedModel } from "../../src/normalized.js"

export const models = [
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/deep-research-max-preview-04-2026",
      "digest": "bd19342f4330c2601839f881406b26b2ceab1d75acc7b03c3ac29df40125a39b"
    },
    "local": {
      "provider": "google",
      "id": "deep-research-max-preview-04-2026"
    },
    "apiID": "deep-research-max-preview-04-2026",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Deep Research Max Preview (Apr-21-2026)",
      "description": "Maximum-comprehensiveness agentic researcher for multi-step investigation, synthesis, and cited reports",
      "family": "gemini-pro",
      "releaseDate": "2026-04-21",
      "lastUpdated": "2026-04-21",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 65536
      },
      "cost": {
        "input": 2,
        "output": 12,
        "cache_read": 0.2,
        "tiers": [
          {
            "input": 4,
            "output": 18,
            "cache_read": 0.4,
            "tier": {
              "type": "context",
              "size": 200000
            }
          }
        ],
        "context_over_200k": {
          "input": 4,
          "output": 18,
          "cache_read": 0.4
        }
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/deep-research-preview-04-2026",
      "digest": "4d888bf03b431449bc39bb70dcae2dabe653931d370cd03de9470c61f05304b0"
    },
    "local": {
      "provider": "google",
      "id": "deep-research-preview-04-2026"
    },
    "apiID": "deep-research-preview-04-2026",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Deep Research Preview (Apr-21-2026)",
      "description": "Agentic model for autonomous multi-step research, synthesis, and cited reports",
      "family": "gemini-pro",
      "releaseDate": "2026-04-21",
      "lastUpdated": "2026-04-21",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 65536
      },
      "cost": {
        "input": 2,
        "output": 12,
        "cache_read": 0.2,
        "tiers": [
          {
            "input": 4,
            "output": 18,
            "cache_read": 0.4,
            "tier": {
              "type": "context",
              "size": 200000
            }
          }
        ],
        "context_over_200k": {
          "input": 4,
          "output": 18,
          "cache_read": 0.4
        }
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-computer-use-preview-10-2025",
      "digest": "b545bc077746a3d44b9657d49d488aa611519427c22dd777a5304225ea1eb3d8"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-computer-use-preview-10-2025"
    },
    "apiID": "gemini-2.5-computer-use-preview-10-2025",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 2.5 Computer Use Preview 10-2025",
      "description": "Specialized Gemini 2.5 model for browser-control agents that automate UI tasks",
      "family": "gemini-pro",
      "releaseDate": "2025-10-07",
      "lastUpdated": "2025-10-07",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 65536
      },
      "cost": {
        "input": 1.25,
        "output": 10,
        "tiers": [
          {
            "input": 2.5,
            "output": 15,
            "tier": {
              "type": "context",
              "size": 200000
            }
          }
        ],
        "context_over_200k": {
          "input": 2.5,
          "output": 15
        }
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-flash",
      "digest": "8586837c924e5e013b426fff568a45226aeb1a959ce61b7eeb18ac078d9c661f"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-flash"
    },
    "apiID": "gemini-2.5-flash",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 2.5 Flash",
      "description": "Fast Gemini workhorse for multimodal apps where latency and price matter",
      "family": "gemini-flash",
      "releaseDate": "2025-06-17",
      "lastUpdated": "2025-06-17",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cache_read": 0.03,
        "input_audio": 1
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "toggle"
        },
        {
          "type": "budget_tokens",
          "min": 0,
          "max": 24576
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-flash-image",
      "digest": "5ee78d31d5ff2333103b2a56e233a1c4c79cb3d239dd8085d139c01d9860eaf9"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-flash-image"
    },
    "apiID": "gemini-2.5-flash-image",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Nano Banana",
      "description": "Nano Banana image model for fast generation, edits, and character-consistent assets",
      "family": "gemini-flash",
      "releaseDate": "2025-08-26",
      "lastUpdated": "2025-08-26",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 32768,
        "output": 32768
      },
      "cost": {
        "input": 0.3,
        "output": 30,
        "cache_read": 0.075
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-flash-lite",
      "digest": "35b0cfc60aeb6544e9a414d4408482572a9ec252793cd9f98b7f4feb4a783133"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-flash-lite"
    },
    "apiID": "gemini-2.5-flash-lite",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 2.5 Flash-Lite",
      "description": "Lean Gemini 2.5 lane for cheap multimodal traffic and quick agents",
      "family": "gemini-flash-lite",
      "releaseDate": "2025-06-17",
      "lastUpdated": "2025-06-17",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.1,
        "output": 0.4,
        "cache_read": 0.01,
        "input_audio": 0.3
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "toggle"
        },
        {
          "type": "budget_tokens",
          "min": 512,
          "max": 24576
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-flash-preview-tts",
      "digest": "b1fcb61bc873d25fdcf4d6650f3fc0d7583e5e38a75525ec79312b3b7cc9a009"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-flash-preview-tts"
    },
    "apiID": "gemini-2.5-flash-preview-tts",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 2.5 Flash Preview TTS",
      "description": "Speech generation model for controllable voice, narration, and audio delivery",
      "family": "gemini-flash",
      "releaseDate": "2025-05-01",
      "lastUpdated": "2025-05-01",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": false,
        "tools": false,
        "temperature": true,
        "input": [
          "text"
        ],
        "output": [
          "audio"
        ]
      },
      "limit": {
        "context": 8192,
        "output": 16384
      },
      "cost": {
        "input": 0.5,
        "output": 10
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-pro",
      "digest": "13009309fd1a2a403b1e865bed15f44668929885b64597dbbc5f2d3ba9acc5ee"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-pro"
    },
    "apiID": "gemini-2.5-pro",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 2.5 Pro",
      "description": "Google's proven reasoning model for coding, math, and multimodal analysis",
      "family": "gemini-pro",
      "releaseDate": "2025-06-17",
      "lastUpdated": "2025-06-17",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 1.25,
        "output": 10,
        "cache_read": 0.125,
        "tiers": [
          {
            "input": 2.5,
            "output": 15,
            "cache_read": 0.25,
            "tier": {
              "type": "context",
              "size": 200000
            }
          }
        ],
        "context_over_200k": {
          "input": 2.5,
          "output": 15,
          "cache_read": 0.25
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "budget_tokens",
          "min": 128,
          "max": 32768
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-2.5-pro-preview-tts",
      "digest": "1963847a44a7deb01b8eb2609b8b12f754744644790720a1a6ba1f188e0c2efb"
    },
    "local": {
      "provider": "google",
      "id": "gemini-2.5-pro-preview-tts"
    },
    "apiID": "gemini-2.5-pro-preview-tts",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 2.5 Pro Preview TTS",
      "description": "Speech generation model for controllable voice, narration, and audio delivery",
      "family": "gemini-flash",
      "releaseDate": "2025-05-01",
      "lastUpdated": "2025-05-01",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": false,
        "tools": false,
        "temperature": true,
        "input": [
          "text"
        ],
        "output": [
          "audio"
        ]
      },
      "limit": {
        "context": 8192,
        "output": 16384
      },
      "cost": {
        "input": 1,
        "output": 20
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3-flash-preview",
      "digest": "c8bedbf2021e6b9104066b327ceabf57431d2a0c2d40754c0649fd695ee1447c"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3-flash-preview"
    },
    "apiID": "gemini-3-flash-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3 Flash Preview",
      "description": "New Gemini flash lane bringing frontier-style multimodal reasoning to cheaper runs",
      "family": "gemini-flash",
      "releaseDate": "2025-12-17",
      "lastUpdated": "2025-12-17",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.5,
        "output": 3,
        "cache_read": 0.05,
        "input_audio": 1
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3-pro-image",
      "digest": "539a09c9bb5e7a624f1a765460fd07253280fbf717b36830b4bc2120efbc6919"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3-pro-image"
    },
    "apiID": "gemini-3-pro-image",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Nano Banana Pro",
      "description": "Nano Banana Pro for higher-fidelity image generation and design-heavy edits",
      "family": "gemini-pro",
      "releaseDate": "2026-05-28",
      "lastUpdated": "2026-05-28",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 32768
      },
      "cost": {
        "input": 2,
        "output": 120
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3-pro-image-preview",
      "digest": "d9305cb0f26d0c41f924a4e050abf2705299b0479b567baeb5729a7a9815a1dc"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3-pro-image-preview"
    },
    "apiID": "gemini-3-pro-image-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Nano Banana Pro",
      "description": "Nano Banana Pro for higher-fidelity image generation and design-heavy edits",
      "family": "gemini-pro",
      "releaseDate": "2025-11-20",
      "lastUpdated": "2025-11-20",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 32768
      },
      "cost": {
        "input": 2,
        "output": 120
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-image",
      "digest": "a8e8ff7f2d4500b1da13986567a4e61da62bdb149f51943ee4f06fd181cd3981"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-image"
    },
    "apiID": "gemini-3.1-flash-image",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Nano Banana 2",
      "description": "Image model for prompt-driven generation, editing, and visual design workflows",
      "family": "gemini-flash",
      "releaseDate": "2026-05-28",
      "lastUpdated": "2026-05-28",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "pdf"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 65536,
        "output": 65536
      },
      "cost": {
        "input": 0.5,
        "output": 60
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-image-preview",
      "digest": "15fd7cceca68ec6d9635b9d30b47321083b96864dbf52b777fcbf7fdd7f1c0e5"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-image-preview"
    },
    "apiID": "gemini-3.1-flash-image-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Nano Banana 2",
      "description": "Image model for prompt-driven generation, editing, and visual design workflows",
      "family": "gemini-flash",
      "releaseDate": "2026-02-26",
      "lastUpdated": "2026-02-26",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 65536,
        "output": 65536
      },
      "cost": {
        "input": 0.5,
        "output": 60
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-lite",
      "digest": "45a09d06da183b2d0a6d1e903d7bac6214ceeb560dbcf9df58ff0cd346148db4"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-lite"
    },
    "apiID": "gemini-3.1-flash-lite",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.1 Flash Lite",
      "description": "Low-latency Gemini model for high-volume multimodal and agent workloads",
      "family": "gemini-flash-lite",
      "releaseDate": "2026-05-07",
      "lastUpdated": "2026-05-07",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.25,
        "output": 1.5,
        "cache_read": 0.025,
        "input_audio": 0.5
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-lite-image",
      "digest": "dab77230871694eaebe6b9dd22b40f1ac2c9b5808c15986e0197ef51847f7918"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-lite-image"
    },
    "apiID": "gemini-3.1-flash-lite-image",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Nano Banana 2 Lite",
      "description": "Fastest, most cost-efficient Gemini image model for high-volume 1K generation and editing",
      "family": "gemini-flash-lite",
      "releaseDate": "2026-06-30",
      "lastUpdated": "2026-06-30",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": false,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 65536,
        "output": 65536
      },
      "cost": {
        "input": 0.25,
        "output": 30
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-lite-preview",
      "digest": "30467e04ae8d90a1191d1ff8417d1e09c114534b7f7a240a083316b0fb307d22"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-lite-preview"
    },
    "apiID": "gemini-3.1-flash-lite-preview",
    "format": "google",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "Gemini 3.1 Flash Lite Preview",
      "description": "Legacy model retained for compatibility with older integrations",
      "family": "gemini-flash-lite",
      "releaseDate": "2026-03-03",
      "lastUpdated": "2026-03-03",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.25,
        "output": 1.5,
        "cache_read": 0.025,
        "input_audio": 0.5
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-live-preview",
      "digest": "7510aeb60828b63b4ed7ae31714dd367773b948893fc643e3f20c18753159714"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-live-preview"
    },
    "apiID": "gemini-3.1-flash-live-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.1 Flash Live Preview",
      "description": "High-quality, low-latency Live API model for real-time dialogue and voice-first AI applications",
      "family": "gemini-flash",
      "releaseDate": "2026-03-26",
      "lastUpdated": "2026-03-26",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": false,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio"
        ],
        "output": [
          "text",
          "audio"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 65536
      },
      "cost": {
        "input": 0.75,
        "output": 4.5,
        "input_audio": 3,
        "output_audio": 12
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-flash-tts-preview",
      "digest": "5fbc9c19f13b3505ad17114861d5c0e0cf1c4f68ed33f511616e35fdebc5e21d"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-flash-tts-preview"
    },
    "apiID": "gemini-3.1-flash-tts-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.1 Flash TTS Preview",
      "description": "Low-latency speech generation with steerable prompts and expressive audio tags",
      "family": "gemini-flash",
      "releaseDate": "2026-04-15",
      "lastUpdated": "2026-04-15",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text"
        ],
        "output": [
          "audio"
        ]
      },
      "limit": {
        "context": 8192,
        "output": 16384
      },
      "cost": {
        "input": 1,
        "output": 20
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-pro-preview",
      "digest": "38f131b1d294970bb6306511d68a5feee715da6565b3bf343da1ee48c7dffed3"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-pro-preview"
    },
    "apiID": "gemini-3.1-pro-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.1 Pro Preview",
      "description": "Reasoning-first Gemini preview for agentic coding and complex problem solving",
      "family": "gemini-pro",
      "releaseDate": "2026-02-19",
      "lastUpdated": "2026-02-19",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 2,
        "output": 12,
        "cache_read": 0.2,
        "tiers": [
          {
            "input": 4,
            "output": 18,
            "cache_read": 0.4,
            "tier": {
              "type": "context",
              "size": 200000
            }
          }
        ],
        "context_over_200k": {
          "input": 4,
          "output": 18,
          "cache_read": 0.4
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.1-pro-preview-customtools",
      "digest": "364d3b48f8bda3ce0045f41f5eaf26563f3d8cbd66341737bdab35f96c6620dd"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.1-pro-preview-customtools"
    },
    "apiID": "gemini-3.1-pro-preview-customtools",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.1 Pro Preview Custom Tools",
      "description": "Advanced Gemini model for complex reasoning, coding, and multimodal analysis",
      "family": "gemini-pro",
      "releaseDate": "2026-02-19",
      "lastUpdated": "2026-02-19",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 2,
        "output": 12,
        "cache_read": 0.2,
        "tiers": [
          {
            "input": 4,
            "output": 18,
            "cache_read": 0.4,
            "tier": {
              "type": "context",
              "size": 200000
            }
          }
        ],
        "context_over_200k": {
          "input": 4,
          "output": 18,
          "cache_read": 0.4
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.5-flash",
      "digest": "6a110f17524955274e3c0ddbdba0ab9314953e1fc04d574b23c947abb7837c2f"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.5-flash"
    },
    "apiID": "gemini-3.5-flash",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.5 Flash",
      "description": "Fast Gemini model balancing multimodal reasoning, tool use, and cost",
      "family": "gemini-flash",
      "releaseDate": "2026-05-19",
      "lastUpdated": "2026-05-19",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 1.5,
        "output": 9,
        "cache_read": 0.15,
        "input_audio": 1.5
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.5-flash-lite",
      "digest": "a0a603dde512f1e5d6f226a39cc4b62de2485e212c2268dd12fa7a7a8db0f94f"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.5-flash-lite"
    },
    "apiID": "gemini-3.5-flash-lite",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.5 Flash Lite",
      "description": "Fast Gemini model balancing multimodal reasoning, tool use, and cost",
      "family": "gemini-flash-lite",
      "releaseDate": "2026-07-21",
      "lastUpdated": "2026-07-21",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cache_read": 0.03
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.5-live-translate-preview",
      "digest": "7411e879e1e091417e3a79950909c01b64d0d334a10b15d75902ef89f380b02a"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.5-live-translate-preview"
    },
    "apiID": "gemini-3.5-live-translate-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.5 Live Translate Preview",
      "description": "Low-latency audio-to-audio model for real-time speech translation across 70+ languages",
      "family": "gemini-pro",
      "releaseDate": "2026-06-09",
      "lastUpdated": "2026-06-09",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": false,
        "tools": false,
        "temperature": true,
        "input": [
          "audio"
        ],
        "output": [
          "audio",
          "text"
        ]
      },
      "limit": {
        "context": 16384,
        "output": 32768
      },
      "cost": {
        "input": 3.5,
        "output": 21,
        "input_audio": 3.5,
        "output_audio": 21
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.6-flash",
      "digest": "a43e93dc3e1de8a8a2744c661ecbc537ec8ff242ca1f29b673e9334ddb118403"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.6-flash"
    },
    "apiID": "gemini-3.6-flash",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.6 Flash",
      "description": "Fast Gemini model balancing multimodal reasoning, tool use, and cost",
      "family": "gemini-flash",
      "releaseDate": "2026-07-21",
      "lastUpdated": "2026-07-21",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.75,
        "output": 3.75,
        "cache_read": 0.075,
        "input_audio": 0.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.7-flash",
      "digest": "7460f42b619c59beb0eb371419d242bc9bf2a4ed0d27aa404686a74131fc0224"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.7-flash"
    },
    "apiID": "gemini-3.7-flash",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.7 Flash",
      "description": "High-efficiency Gemini model for agentic workflows, coding, and multimodal reasoning",
      "family": "gemini-flash",
      "releaseDate": "2026-08-13",
      "lastUpdated": "2026-08-13",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.75,
        "output": 3.75,
        "cache_read": 0.075,
        "input_audio": 0.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-3.8-flash",
      "digest": "ff53916aedf025f23b336937e2a7eb6f0e81e1a93d3375d9c0719b8745981f97"
    },
    "local": {
      "provider": "google",
      "id": "gemini-3.8-flash"
    },
    "apiID": "gemini-3.8-flash",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini 3.8 Flash",
      "description": "Google's most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows",
      "family": "gemini-flash",
      "releaseDate": "2026-09-02",
      "lastUpdated": "2026-09-02",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.75,
        "output": 3.75,
        "cache_read": 0.075,
        "input_audio": 0.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-embedding-001",
      "digest": "6dd4d5a1c0e4f0f2d760e8decd128e6d8dc34b44458b5af8dd5a6d9867f6bd9e"
    },
    "local": {
      "provider": "google",
      "id": "gemini-embedding-001"
    },
    "apiID": "gemini-embedding-001",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini Embedding 001",
      "description": "Embedding model for semantic search, retrieval, clustering, and ranking pipelines",
      "family": "gemini",
      "releaseDate": "2025-05-20",
      "lastUpdated": "2025-05-20",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": false,
        "tools": false,
        "temperature": false,
        "input": [
          "text"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 2048,
        "output": 1
      },
      "cost": {
        "input": 0.15,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-embedding-2",
      "digest": "9f8cf98f916e88fa4d1ca1d06e17bccf31ccee08fa9d0f723fa4e77d451aa05d"
    },
    "local": {
      "provider": "google",
      "id": "gemini-embedding-2"
    },
    "apiID": "gemini-embedding-2",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini Embedding 2",
      "description": "Multimodal embedding model mapping text, images, video, audio, and PDFs into a unified embedding space",
      "family": "gemini",
      "releaseDate": "2026-04-22",
      "lastUpdated": "2026-04-22",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": false,
        "temperature": false,
        "input": [
          "text",
          "image",
          "audio",
          "video",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 8192,
        "output": 1
      },
      "cost": {
        "input": 0.2,
        "output": 0,
        "input_audio": 6.5
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-flash-latest",
      "digest": "d0a590d04e66d5cdd4ad7405e9cc2ea4625f79db212cc091a349b13eadd35128"
    },
    "local": {
      "provider": "google",
      "id": "gemini-flash-latest"
    },
    "apiID": "gemini-flash-latest",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini Flash Latest",
      "description": "High-efficiency Gemini model for agentic workflows, coding, and multimodal reasoning",
      "family": "gemini-flash",
      "releaseDate": "2026-08-13",
      "lastUpdated": "2026-08-13",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.75,
        "output": 3.75,
        "cache_read": 0.075,
        "input_audio": 0.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-flash-lite-latest",
      "digest": "103c707b5d4baeb419d40f2c3b7475c374d7957b4db751665442a4839e50be29"
    },
    "local": {
      "provider": "google",
      "id": "gemini-flash-lite-latest"
    },
    "apiID": "gemini-flash-lite-latest",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini Flash-Lite Latest",
      "description": "Fast Gemini model balancing multimodal reasoning, tool use, and cost",
      "family": "gemini-flash-lite",
      "releaseDate": "2026-07-21",
      "lastUpdated": "2026-07-21",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video",
          "audio",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0.3,
        "output": 2.5,
        "cache_read": 0.03
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "minimal",
            "low",
            "medium",
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemini-omni-flash-preview",
      "digest": "95445a86e4ae09a941331de0076d1bddce77b8c7ab4ec28ecf4fce6b15a4317e"
    },
    "local": {
      "provider": "google",
      "id": "gemini-omni-flash-preview"
    },
    "apiID": "gemini-omni-flash-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemini Omni Flash Preview",
      "description": "Video generation and editing model for fast, conversational text- and image-to-video workflows",
      "family": "gemini",
      "releaseDate": "2026-06-30",
      "lastUpdated": "2026-06-30",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": false,
        "temperature": true,
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "video"
        ]
      },
      "limit": {
        "context": 131072,
        "output": 65536
      },
      "cost": {
        "input": 1.5,
        "output": 17.5
      }
    },
    "unsupported": {
      "reasoningOptions": []
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemma-4-26b-a4b-it",
      "digest": "5059a5edd515dd44e9e8c7bf805dd039ee307f9ab043cff30808f262bbba7c69"
    },
    "local": {
      "provider": "google",
      "id": "gemma-4-26b-a4b-it"
    },
    "apiID": "gemma-4-26b-a4b-it",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemma 4 26B A4B IT",
      "description": "Open Gemma instruction model for efficient chat and self-hosted deployments",
      "family": "gemma",
      "releaseDate": "2026-04-02",
      "lastUpdated": "2026-04-02",
      "openWeights": true,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 262144,
        "output": 32768
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "toggle"
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/gemma-4-31b-it",
      "digest": "490ed0a51cfc937ca7b8256ad37f1ada3f1fa856d928ba0ee8d6c79e654b96be"
    },
    "local": {
      "provider": "google",
      "id": "gemma-4-31b-it"
    },
    "apiID": "gemma-4-31b-it",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Gemma 4 31B IT",
      "description": "Largest Gemma 4 instruction model for open, self-hosted chat and reasoning",
      "family": "gemma",
      "releaseDate": "2026-04-02",
      "lastUpdated": "2026-04-02",
      "openWeights": true,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 262144,
        "output": 32768
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "toggle"
        }
      ]
    }
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/lyria-3-clip-preview",
      "digest": "2a02b24d32f223839565b481b017c8c5e05e7a41787c8b17776e8c82e2c205be"
    },
    "local": {
      "provider": "google",
      "id": "lyria-3-clip-preview"
    },
    "apiID": "lyria-3-clip-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Lyria 3 Clip Preview",
      "description": "Music generation model for short 30-second clips, loops, and previews from text or image prompts",
      "family": "lyria",
      "releaseDate": "2026-03-25",
      "lastUpdated": "2026-03-25",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": false,
        "structuredOutput": false,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text",
          "audio"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/lyria-3-pro-preview",
      "digest": "d3bb8e99759332692d048379d3867329fc47edfe506bac3a0429d2549e109b65"
    },
    "local": {
      "provider": "google",
      "id": "lyria-3-pro-preview"
    },
    "apiID": "lyria-3-pro-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Lyria 3 Pro Preview",
      "description": "Music generation model for full-length songs from text or images with vocals and structure",
      "family": "lyria",
      "releaseDate": "2026-03-25",
      "lastUpdated": "2026-03-25",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": false,
        "structuredOutput": false,
        "temperature": true,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text",
          "audio"
        ]
      },
      "limit": {
        "context": 1048576,
        "output": 65536
      },
      "cost": {
        "input": 0,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/veo-3.1-fast-generate-preview",
      "digest": "fc1a49f9af1749d2015a652262cff05f5eb739d021e7b0d9792225a4bd46f0b6"
    },
    "local": {
      "provider": "google",
      "id": "veo-3.1-fast-generate-preview"
    },
    "apiID": "veo-3.1-fast-generate-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Veo 3.1 fast",
      "description": "Video model for prompt-guided generation, editing, and motion workflows",
      "family": "veo",
      "releaseDate": "2025-10-15",
      "lastUpdated": "2026-01-01",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": false,
        "temperature": false,
        "input": [
          "text",
          "image",
          "video"
        ],
        "output": [
          "video"
        ]
      },
      "limit": {
        "context": 480,
        "output": 8192
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/veo-3.1-generate-preview",
      "digest": "3fb6b2b8ac0d3ae3d3705c757df0f9f820f2edafda8204da510e51b9a309b814"
    },
    "local": {
      "provider": "google",
      "id": "veo-3.1-generate-preview"
    },
    "apiID": "veo-3.1-generate-preview",
    "format": "google",
    "lifecycle": "beta",
    "metadata": {
      "name": "Veo 3.1",
      "description": "Video model for prompt-guided generation, editing, and motion workflows",
      "family": "veo",
      "releaseDate": "2025-10-15",
      "lastUpdated": "2026-01",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": false,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "video"
        ]
      },
      "limit": {
        "context": 480,
        "output": 8192
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "google",
      "path": "providers/google/models/veo-3.1-lite-generate-preview",
      "digest": "a6a7508dfd4222c0ea439d8108a5d0eb9fe06169bb03306f58189d50cb2a7360"
    },
    "local": {
      "provider": "google",
      "id": "veo-3.1-lite-generate-preview"
    },
    "apiID": "veo-3.1-lite-generate-preview",
    "format": "google",
    "lifecycle": "active",
    "metadata": {
      "name": "Veo 3.1 lite",
      "description": "Video model for prompt-guided generation, editing, and motion workflows",
      "family": "veo",
      "releaseDate": "2026-03-31",
      "lastUpdated": "2026-03-31",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": false,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "video"
        ]
      },
      "limit": {
        "context": 480,
        "output": 8192
      }
    },
    "unsupported": {}
  }
] as const satisfies ReadonlyArray<GeneratedModel>
