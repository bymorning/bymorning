import type { GeneratedModel } from "../../src/normalized.js"

export const models = [
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/chatgpt-image-latest",
      "digest": "e75e1a6aebc003805eb0ffbf453add685244c5cdeb6c606a5a04e5dea6cefa79"
    },
    "local": {
      "provider": "openai",
      "id": "chatgpt-image-latest"
    },
    "apiID": "chatgpt-image-latest",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "chatgpt-image-latest",
      "description": "Image model for prompt-driven generation, editing, and visual design workflows",
      "family": "gpt-image",
      "releaseDate": "2025-12-16",
      "lastUpdated": "2025-12-16",
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
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 0,
        "input": 0,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-3.5-turbo",
      "digest": "00e272817767d53f57003226e7728179673a0101b92ea070a373956f816de5ba"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-3.5-turbo"
    },
    "apiID": "gpt-3.5-turbo",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-3.5-turbo",
      "description": "Compact GPT model for low-latency assistance and high-volume workloads",
      "family": "gpt",
      "releaseDate": "2023-03-01",
      "lastUpdated": "2023-11-06",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": false,
        "tools": false,
        "structuredOutput": false,
        "temperature": true,
        "input": [
          "text"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 16385,
        "output": 4096
      },
      "cost": {
        "input": 0.5,
        "output": 1.5,
        "cache_read": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4",
      "digest": "f6e48d9dc3e1263b8fbd96519c84cd12a9358a56da66429d80a0de11bbc41255"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4"
    },
    "apiID": "gpt-4",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-4",
      "description": "GPT model for general reasoning, writing, coding, and tool-assisted tasks",
      "family": "gpt",
      "releaseDate": "2023-11-06",
      "lastUpdated": "2024-04-09",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": true,
        "structuredOutput": false,
        "temperature": true,
        "input": [
          "text"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 8192,
        "output": 8192
      },
      "cost": {
        "input": 30,
        "output": 60
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4-turbo",
      "digest": "0cc76b6704af9d92c0cfc6e8ce5312a780ebdc592dda88e2117df47da98a797a"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4-turbo"
    },
    "apiID": "gpt-4-turbo",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-4 Turbo",
      "description": "Compact GPT model for low-latency assistance and high-volume workloads",
      "family": "gpt",
      "releaseDate": "2023-11-06",
      "lastUpdated": "2024-04-09",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": true,
        "structuredOutput": false,
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
        "context": 128000,
        "output": 4096
      },
      "cost": {
        "input": 10,
        "output": 30
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4.1",
      "digest": "bf226eb89c54094124817641dbd2208fb246c85469b7282402ee4fb0ac6c21c7"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4.1"
    },
    "apiID": "gpt-4.1",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-4.1",
      "description": "Long-lived GPT workhorse for coding, instruction following, and production apps",
      "family": "gpt",
      "releaseDate": "2025-04-14",
      "lastUpdated": "2025-04-14",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1047576,
        "output": 32768
      },
      "cost": {
        "input": 2,
        "output": 8,
        "cache_read": 0.5
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4.1-mini",
      "digest": "66a0c3ae0ef96bbe291f29184bce7b9db17ff34ca701f1273a6be525a7fce464"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4.1-mini"
    },
    "apiID": "gpt-4.1-mini",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-4.1 mini",
      "description": "Affordable GPT-4.1 lane for fast coding help and structured extraction",
      "family": "gpt-mini",
      "releaseDate": "2025-04-14",
      "lastUpdated": "2025-04-14",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1047576,
        "output": 32768
      },
      "cost": {
        "input": 0.4,
        "output": 1.6,
        "cache_read": 0.1
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4.1-nano",
      "digest": "4e2901a57dcb1c0a8d16c4b59fbe91eae99cf6bf87d8e14d648e383326a45c9e"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4.1-nano"
    },
    "apiID": "gpt-4.1-nano",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-4.1 nano",
      "description": "Tiny GPT-4.1 option for classification, routing, and very high-volume tasks",
      "family": "gpt-nano",
      "releaseDate": "2025-04-14",
      "lastUpdated": "2025-04-14",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
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
        "context": 1047576,
        "output": 32768
      },
      "cost": {
        "input": 0.1,
        "output": 0.4,
        "cache_read": 0.025
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4o",
      "digest": "14da005451dab134056725934ec678dc0aadea46d7fef4151aa1b1f2efbfd476"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4o"
    },
    "apiID": "gpt-4o",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-4o",
      "description": "Omni-era GPT for multimodal chat, practical coding, and general assistants",
      "family": "gpt",
      "releaseDate": "2024-05-13",
      "lastUpdated": "2024-08-06",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 128000,
        "output": 16384
      },
      "cost": {
        "input": 2.5,
        "output": 10,
        "cache_read": 1.25
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4o-2024-05-13",
      "digest": "1dfc34533ba32cd1f009244cddf392520ca11e0b040ff1303d1327bd37b24a3e"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4o-2024-05-13"
    },
    "apiID": "gpt-4o-2024-05-13",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-4o (2024-05-13)",
      "description": "GPT model for general reasoning, writing, coding, and tool-assisted tasks",
      "family": "gpt",
      "releaseDate": "2024-05-13",
      "lastUpdated": "2024-05-13",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
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
        "context": 128000,
        "output": 4096
      },
      "cost": {
        "input": 5,
        "output": 15
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4o-2024-08-06",
      "digest": "56f07cf121dad52501381c38f0ad80cef377aba730d7824d2beba286a5473d5d"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4o-2024-08-06"
    },
    "apiID": "gpt-4o-2024-08-06",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-4o (2024-08-06)",
      "description": "GPT model for general reasoning, writing, coding, and tool-assisted tasks",
      "family": "gpt",
      "releaseDate": "2024-08-06",
      "lastUpdated": "2024-08-06",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
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
        "context": 128000,
        "output": 16384
      },
      "cost": {
        "input": 2.5,
        "output": 10,
        "cache_read": 1.25
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4o-2024-11-20",
      "digest": "b9a98049e5500a04ba634a95c2d6f0e3065f46d58867938967a93184823cab24"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4o-2024-11-20"
    },
    "apiID": "gpt-4o-2024-11-20",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-4o (2024-11-20)",
      "description": "GPT model for general reasoning, writing, coding, and tool-assisted tasks",
      "family": "gpt",
      "releaseDate": "2024-11-20",
      "lastUpdated": "2024-11-20",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
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
        "context": 128000,
        "output": 16384
      },
      "cost": {
        "input": 2.5,
        "output": 10,
        "cache_read": 1.25
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-4o-mini",
      "digest": "5fb6565f9e7ef5ed39a48fe87200f8987a6ac7c638f43abbbf250ccee5a31c1b"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-4o-mini"
    },
    "apiID": "gpt-4o-mini",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-4o mini",
      "description": "Small omni GPT for cheap multimodal assistance and production-scale traffic",
      "family": "gpt-mini",
      "releaseDate": "2024-07-18",
      "lastUpdated": "2024-07-18",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
        "tools": true,
        "structuredOutput": true,
        "temperature": true,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 128000,
        "output": 16384
      },
      "cost": {
        "input": 0.15,
        "output": 0.6,
        "cache_read": 0.075
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5",
      "digest": "00f79fdf3059b155634d330c5377942b997f866d2894be18bc1fd27cbdf492d3"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5"
    },
    "apiID": "gpt-5",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5",
      "description": "Original GPT-5 workhorse for reasoning, coding, writing, and tool workflows",
      "family": "gpt",
      "releaseDate": "2025-08-07",
      "lastUpdated": "2025-08-07",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 1.25,
        "output": 10,
        "cache_read": 0.125
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
      "provider": "openai",
      "path": "providers/openai/models/gpt-5-mini",
      "digest": "7b5dc8d3ac5ce77fd307052be841b235365ee5d2da4ad8dc8e80c5454ed580fc"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5-mini"
    },
    "apiID": "gpt-5-mini",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5 Mini",
      "description": "Small GPT-5 for responsive agents, coding help, and everyday automation",
      "family": "gpt-mini",
      "releaseDate": "2025-08-07",
      "lastUpdated": "2025-08-07",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 0.25,
        "output": 2,
        "cache_read": 0.025
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
      "provider": "openai",
      "path": "providers/openai/models/gpt-5-nano",
      "digest": "55ad266d71c0bdd84b140501c88c4b21748ce9b8d029b99bb0f60c950e7674a3"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5-nano"
    },
    "apiID": "gpt-5-nano",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5 Nano",
      "description": "Tiny GPT-5 lane for routing, extraction, classification, and bulk jobs",
      "family": "gpt-nano",
      "releaseDate": "2025-08-07",
      "lastUpdated": "2025-08-07",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 0.05,
        "output": 0.4,
        "cache_read": 0.005
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
      "provider": "openai",
      "path": "providers/openai/models/gpt-5-pro",
      "digest": "c6ee3d21c7734aa62aed7b1f3a437056ca076605b92b0657f2d84b5bbc04379d"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5-pro"
    },
    "apiID": "gpt-5-pro",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5 Pro",
      "description": "Higher-accuracy GPT-5 tier for tough analysis, coding reviews, and planning",
      "family": "gpt-pro",
      "releaseDate": "2025-10-06",
      "lastUpdated": "2025-10-06",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 272000
      },
      "cost": {
        "input": 15,
        "output": 120
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "high"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.1",
      "digest": "e68ee6debed8f295db999ee4b1bba0b409a18fd368aac190f0052b2c4c7c05b0"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.1"
    },
    "apiID": "gpt-5.1",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.1",
      "description": "Sharper GPT-5 generation for coding, product work, and tool-assisted tasks",
      "family": "gpt",
      "releaseDate": "2025-11-13",
      "lastUpdated": "2025-11-13",
      "openWeights": false,
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
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 1.25,
        "output": 10,
        "cache_read": 0.125
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
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
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.2",
      "digest": "8628f59c6e441bf79f28aa0a2ae350cd8b4053b4899ad6b740593e81fcd63895"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.2"
    },
    "apiID": "gpt-5.2",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.2",
      "description": "Reliable GPT generation for broad coding, writing, and tool-assisted product work",
      "family": "gpt",
      "releaseDate": "2025-12-11",
      "lastUpdated": "2025-12-11",
      "openWeights": false,
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
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 1.75,
        "output": 14,
        "cache_read": 0.175
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.2-chat-latest",
      "digest": "165cd509473f49666778e7af07734188f8338264cd0ba2cdeab1cce2a8c60514"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.2-chat-latest"
    },
    "apiID": "gpt-5.2-chat-latest",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-5.2 Chat",
      "description": "Chat-tuned GPT model for conversational assistance, writing, and tool workflows",
      "family": "gpt-codex",
      "releaseDate": "2025-12-11",
      "lastUpdated": "2025-12-11",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 128000,
        "output": 16384
      },
      "cost": {
        "input": 1.75,
        "output": 14,
        "cache_read": 0.175
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "medium"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.2-pro",
      "digest": "d3ae020eabb2a0b6cf49748d09f992a091b7c0bd38891be731f4648c5e0e6ac1"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.2-pro"
    },
    "apiID": "gpt-5.2-pro",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.2 Pro",
      "description": "Higher-accuracy GPT-5.2 variant for tougher reasoning and review workflows",
      "family": "gpt-pro",
      "releaseDate": "2025-12-11",
      "lastUpdated": "2025-12-11",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": false,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 21,
        "output": 168
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.3-chat-latest",
      "digest": "9f329970322624ff386868962718ee34c318278c4f185f4c97a88522821f8768"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.3-chat-latest"
    },
    "apiID": "gpt-5.3-chat-latest",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "GPT-5.3 Chat (latest)",
      "description": "Chat-tuned GPT model for conversational assistance, writing, and tool workflows",
      "family": "gpt",
      "releaseDate": "2026-03-03",
      "lastUpdated": "2026-03-03",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": false,
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
        "context": 128000,
        "output": 16384
      },
      "cost": {
        "input": 1.75,
        "output": 14,
        "cache_read": 0.175
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.3-codex",
      "digest": "b1c996a7d7e710b8e1aca96dc433010d3efcdf88ec54a61f07ca1068e2d6fd3c"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.3-codex"
    },
    "apiID": "gpt-5.3-codex",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.3 Codex",
      "description": "Coding-optimized GPT model for repository edits, reviews, and agentic software work",
      "family": "gpt-codex",
      "releaseDate": "2026-02-05",
      "lastUpdated": "2026-02-05",
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
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 1.75,
        "output": 14,
        "cache_read": 0.175
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.3-codex-spark",
      "digest": "8cd2e32620c3bbf4820690263ab3582b61126ff948e853340c486854e915932a"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.3-codex-spark"
    },
    "apiID": "gpt-5.3-codex-spark",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.3 Codex Spark",
      "description": "Coding-optimized GPT model for repository edits, reviews, and agentic software work",
      "family": "gpt-codex-spark",
      "releaseDate": "2026-02-05",
      "lastUpdated": "2026-02-05",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 128000,
        "input": 100000,
        "output": 32000
      },
      "cost": {
        "input": 1.75,
        "output": 14,
        "cache_read": 0.175
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.4",
      "digest": "6910ee1f8bc58d1895db9cdee27af97df88d20c74d893f59bb99dc88b0d22e29"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.4"
    },
    "apiID": "gpt-5.4",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.4",
      "description": "Agent-ready GPT for coding and computer-use workflows at a lower cost",
      "family": "gpt",
      "releaseDate": "2026-03-05",
      "lastUpdated": "2026-03-05",
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
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 2.5,
        "output": 15,
        "cache_read": 0.25,
        "tiers": [
          {
            "input": 5,
            "output": 22.5,
            "cache_read": 0.5,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 5,
          "output": 22.5,
          "cache_read": 0.5
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 5,
            "output": 30,
            "cache_read": 0.5
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.4-mini",
      "digest": "b74122e31393c0015ce246289a16217aad304f60ecb000ffabc14a4a7a8abb78"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.4-mini"
    },
    "apiID": "gpt-5.4-mini",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.4 mini",
      "description": "Strong small GPT for coding subagents, quick tool use, and high-volume work",
      "family": "gpt-mini",
      "releaseDate": "2026-03-17",
      "lastUpdated": "2026-03-17",
      "openWeights": false,
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
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 0.75,
        "output": 4.5,
        "cache_read": 0.075
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 1.5,
            "output": 9,
            "cache_read": 0.15
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.4-nano",
      "digest": "3c034bff3fbfc667d3a0c1c6c369cd8f7bf094c5190d1dc7879786cc90a2e591"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.4-nano"
    },
    "apiID": "gpt-5.4-nano",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.4 nano",
      "description": "Cheapest GPT-5.4 lane for simple routing, extraction, and bulk automation",
      "family": "gpt-nano",
      "releaseDate": "2026-03-17",
      "lastUpdated": "2026-03-17",
      "openWeights": false,
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
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "cost": {
        "input": 0.2,
        "output": 1.25,
        "cache_read": 0.02
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.4-pro",
      "digest": "ec365de51fc9b9b6d4b0097cf1720369c4eca5fa3f2efd2ba7fed4e3417d6821"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.4-pro"
    },
    "apiID": "gpt-5.4-pro",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.4 Pro",
      "description": "More exact GPT-5.4 tier for demanding professional reasoning and agent tasks",
      "family": "gpt-pro",
      "releaseDate": "2026-03-05",
      "lastUpdated": "2026-03-05",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": false,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 30,
        "output": 180,
        "tiers": [
          {
            "input": 60,
            "output": 270,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 60,
          "output": 270
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.5",
      "digest": "983b4fc08918a9d95928b92a8b69ae694a10f5ee8a185c65bf0f5b71b57adae4"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.5"
    },
    "apiID": "gpt-5.5",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.5",
      "description": "Default frontier GPT for coding, computer use, research, and knowledge work",
      "family": "gpt",
      "releaseDate": "2026-04-23",
      "lastUpdated": "2026-04-23",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 5,
        "output": 30,
        "cache_read": 0.5,
        "tiers": [
          {
            "input": 10,
            "output": 45,
            "cache_read": 1,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 10,
          "output": 45,
          "cache_read": 1
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 12.5,
            "output": 75,
            "cache_read": 1.25
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.5-pro",
      "digest": "7b0ac730b38fae88abcc1511ac3d2e974c4d73a323b6ed44336d044cb57ca066"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.5-pro"
    },
    "apiID": "gpt-5.5-pro",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.5 Pro",
      "description": "Highest-accuracy GPT-5.5 tier for slower, precision-heavy reasoning and coding",
      "family": "gpt-pro",
      "releaseDate": "2026-04-23",
      "lastUpdated": "2026-04-23",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 30,
        "output": 180,
        "tiers": [
          {
            "input": 60,
            "output": 270,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 60,
          "output": 270
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "medium",
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.6",
      "digest": "e309edcb0204dca4ce5761c4d3351f6bb5cd6d6a44a0320c9da77c08e69eef75"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.6"
    },
    "apiID": "gpt-5.6",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.6",
      "description": "Frontier GPT-5.6 model for complex professional work, coding, and agentic workflows",
      "family": "gpt-sol",
      "releaseDate": "2026-07-09",
      "lastUpdated": "2026-07-09",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 4,
        "output": 20,
        "cache_read": 0.4,
        "cache_write": 5,
        "tiers": [
          {
            "input": 8,
            "output": 30,
            "cache_read": 0.8,
            "cache_write": 10,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 8,
          "output": 30,
          "cache_read": 0.8,
          "cache_write": 10
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 8,
            "output": 40,
            "cache_read": 0.8,
            "cache_write": 10
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        },
        "pro": {
          "provider": {
            "body": {
              "reasoning": {
                "mode": "pro"
              }
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.6-luna",
      "digest": "805980ca2122a1ff485da2e42ade1f1fedf8c2d4d16c167a6f17e0b94b287de1"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.6-luna"
    },
    "apiID": "gpt-5.6-luna",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.6 Luna",
      "description": "Cost-efficient GPT-5.6 model for fast, high-volume workloads",
      "family": "gpt-luna",
      "releaseDate": "2026-07-09",
      "lastUpdated": "2026-07-09",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 0.2,
        "output": 1.2,
        "cache_read": 0.02,
        "cache_write": 0.25,
        "tiers": [
          {
            "input": 0.4,
            "output": 1.8,
            "cache_read": 0.04,
            "cache_write": 0.5,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 0.4,
          "output": 1.8,
          "cache_read": 0.04,
          "cache_write": 0.5
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 0.4,
            "output": 2.4,
            "cache_read": 0.04,
            "cache_write": 0.5
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        },
        "pro": {
          "provider": {
            "body": {
              "reasoning": {
                "mode": "pro"
              }
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.6-sol",
      "digest": "03c186b2248a40a17825ea718c529d2018d18ceab5e76acaafdc4c1bae1f5021"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.6-sol"
    },
    "apiID": "gpt-5.6-sol",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.6 Sol",
      "description": "Frontier GPT-5.6 model for complex professional work, coding, and agentic workflows",
      "family": "gpt-sol",
      "releaseDate": "2026-07-09",
      "lastUpdated": "2026-07-09",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 4,
        "output": 20,
        "cache_read": 0.4,
        "cache_write": 5,
        "tiers": [
          {
            "input": 8,
            "output": 30,
            "cache_read": 0.8,
            "cache_write": 10,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 8,
          "output": 30,
          "cache_read": 0.8,
          "cache_write": 10
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 8,
            "output": 40,
            "cache_read": 0.8,
            "cache_write": 10
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        },
        "pro": {
          "provider": {
            "body": {
              "reasoning": {
                "mode": "pro"
              }
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-5.6-terra",
      "digest": "d1ad5957adbc67d12ab9b484bd2a4ad0c3776dc4138abe86bddc74a1e5287763"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-5.6-terra"
    },
    "apiID": "gpt-5.6-terra",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-5.6 Terra",
      "description": "Balanced GPT-5.6 model for capable, cost-efficient everyday work",
      "family": "gpt-terra",
      "releaseDate": "2026-07-09",
      "lastUpdated": "2026-07-09",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 1050000,
        "input": 922000,
        "output": 128000
      },
      "cost": {
        "input": 2,
        "output": 12,
        "cache_read": 0.2,
        "cache_write": 2.5,
        "tiers": [
          {
            "input": 4,
            "output": 18,
            "cache_read": 0.4,
            "cache_write": 5,
            "tier": {
              "type": "context",
              "size": 272000
            }
          }
        ],
        "context_over_200k": {
          "input": 4,
          "output": 18,
          "cache_read": 0.4,
          "cache_write": 5
        }
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "none",
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ],
      "experimentalModes": {
        "fast": {
          "cost": {
            "input": 4,
            "output": 24,
            "cache_read": 0.4,
            "cache_write": 5
          },
          "provider": {
            "body": {
              "service_tier": "priority"
            }
          }
        },
        "pro": {
          "provider": {
            "body": {
              "reasoning": {
                "mode": "pro"
              }
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-image-1",
      "digest": "c35d817fbc000813dd14354d19caacccb93d4bb932d8b5f0fa511265dff39b13"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-image-1"
    },
    "apiID": "gpt-image-1",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "gpt-image-1",
      "description": "OpenAI image model for production generation, edits, and brand-safe visual workflows",
      "family": "gpt-image",
      "releaseDate": "2025-04-24",
      "lastUpdated": "2025-04-24",
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
          "image"
        ]
      },
      "limit": {
        "context": 0,
        "input": 0,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-image-1-mini",
      "digest": "d0f14a809fc91043015623c496aee8d9349674823f22dffe37f7f346f08feef1"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-image-1-mini"
    },
    "apiID": "gpt-image-1-mini",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "gpt-image-1-mini",
      "description": "Image model for prompt-driven generation, editing, and visual design workflows",
      "family": "gpt-image",
      "releaseDate": "2025-09-26",
      "lastUpdated": "2025-09-26",
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
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 0,
        "input": 0,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-image-1.5",
      "digest": "b0196ae7d7e31aa6af447d4e531df3e70fb3bd141219c5c9ef6de065e8b626e5"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-image-1.5"
    },
    "apiID": "gpt-image-1.5",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "gpt-image-1.5",
      "description": "Image model for prompt-driven generation, editing, and visual design workflows",
      "family": "gpt-image",
      "releaseDate": "2025-11-25",
      "lastUpdated": "2025-11-25",
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
          "text",
          "image"
        ]
      },
      "limit": {
        "context": 0,
        "input": 0,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-image-2",
      "digest": "7deaa7bfe3766ea507674ea76d5a02f7047768a458dfdfda8a47d520b26700f2"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-image-2"
    },
    "apiID": "gpt-image-2",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "gpt-image-2",
      "description": "Image model for prompt-driven generation, editing, and visual design workflows",
      "family": "gpt-image",
      "releaseDate": "2026-04-21",
      "lastUpdated": "2026-04-21",
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
          "image"
        ]
      },
      "limit": {
        "context": 0,
        "input": 0,
        "output": 0
      },
      "cost": {
        "input": 5,
        "output": 30,
        "cache_read": 1.25
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/gpt-realtime-2.1",
      "digest": "d76311c4ffddbd0032ab4d026529a708b4defd503ef18507e18f0ac11385dc52"
    },
    "local": {
      "provider": "openai",
      "id": "gpt-realtime-2.1"
    },
    "apiID": "gpt-realtime-2.1",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "GPT-Realtime-2.1",
      "description": "Realtime speech-to-speech model with configurable reasoning, tool use, and robust voice-agent behavior",
      "family": "gpt",
      "releaseDate": "2026-07-06",
      "lastUpdated": "2026-07-06",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": false,
        "temperature": false,
        "input": [
          "text",
          "audio",
          "image"
        ],
        "output": [
          "text",
          "audio"
        ]
      },
      "limit": {
        "context": 128000,
        "input": 96000,
        "output": 32000
      },
      "cost": {
        "input": 4,
        "output": 24,
        "cache_read": 0.4,
        "input_audio": 32,
        "output_audio": 64
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
            "high",
            "xhigh"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/o1",
      "digest": "abe573b7061e9261600a504e419319b840bbad7533cfd63a0e5ae7409ff4750c"
    },
    "local": {
      "provider": "openai",
      "id": "o1"
    },
    "apiID": "o1",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "o1",
      "description": "O-series reasoning model for hard analysis, math, coding, and planning",
      "family": "o",
      "releaseDate": "2024-12-05",
      "lastUpdated": "2024-12-05",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 200000,
        "output": 100000
      },
      "cost": {
        "input": 15,
        "output": 60,
        "cache_read": 7.5
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
      "provider": "openai",
      "path": "providers/openai/models/o1-pro",
      "digest": "991dc515a41b02f2cb858f8478afb36a74ff8f25fe0438c1e3cbd3c5f2b5af01"
    },
    "local": {
      "provider": "openai",
      "id": "o1-pro"
    },
    "apiID": "o1-pro",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "o1-pro",
      "description": "O-series reasoning model for hard analysis, math, coding, and planning",
      "family": "o-pro",
      "releaseDate": "2025-03-19",
      "lastUpdated": "2025-03-19",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 200000,
        "output": 100000
      },
      "cost": {
        "input": 150,
        "output": 600
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
      "provider": "openai",
      "path": "providers/openai/models/o3",
      "digest": "c277d1b21384a60634aa029ab8bbaceda4a32ac5ee9a5e75e0e1d43022c961a4"
    },
    "local": {
      "provider": "openai",
      "id": "o3"
    },
    "apiID": "o3",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "o3",
      "description": "Deliberate o-series reasoner for hard math, coding, and multi-step analysis",
      "family": "o",
      "releaseDate": "2025-04-16",
      "lastUpdated": "2025-04-16",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image",
          "pdf"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 200000,
        "output": 100000
      },
      "cost": {
        "input": 2,
        "output": 8,
        "cache_read": 0.5
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
      "provider": "openai",
      "path": "providers/openai/models/o3-mini",
      "digest": "ad674ab55df6958b996e3d3f1cf98ebe1d8379606a0996577a6f9c904c2ff204"
    },
    "local": {
      "provider": "openai",
      "id": "o3-mini"
    },
    "apiID": "o3-mini",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "o3-mini",
      "description": "Smaller o-series reasoner for economical coding, math, and planning tasks",
      "family": "o-mini",
      "releaseDate": "2024-12-20",
      "lastUpdated": "2025-01-29",
      "openWeights": false,
      "capabilities": {
        "attachment": false,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 200000,
        "output": 100000
      },
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cache_read": 0.55
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
      "provider": "openai",
      "path": "providers/openai/models/o3-pro",
      "digest": "5b1075c7cf64f4e11c9a28aafe19cfeb2e24594a7b3f1eb8f2354e90a75cb6ee"
    },
    "local": {
      "provider": "openai",
      "id": "o3-pro"
    },
    "apiID": "o3-pro",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "o3-pro",
      "description": "High-effort o3 tier for difficult technical reasoning and careful answers",
      "family": "o-pro",
      "releaseDate": "2025-06-10",
      "lastUpdated": "2025-06-10",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 200000,
        "output": 100000
      },
      "cost": {
        "input": 20,
        "output": 80
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
      "provider": "openai",
      "path": "providers/openai/models/o4-mini",
      "digest": "67d6b701bdba34fa8fcafe6e89913c7a9887e85129aba27ab8ba9eadbd5dc47d"
    },
    "local": {
      "provider": "openai",
      "id": "o4-mini"
    },
    "apiID": "o4-mini",
    "format": "openai",
    "lifecycle": "deprecated",
    "metadata": {
      "name": "o4-mini",
      "description": "Fast o-series model for compact reasoning, coding, and tool use",
      "family": "o-mini",
      "releaseDate": "2025-04-16",
      "lastUpdated": "2025-04-16",
      "openWeights": false,
      "capabilities": {
        "attachment": true,
        "reasoning": true,
        "tools": true,
        "structuredOutput": true,
        "temperature": false,
        "input": [
          "text",
          "image"
        ],
        "output": [
          "text"
        ]
      },
      "limit": {
        "context": 200000,
        "output": 100000
      },
      "cost": {
        "input": 1.1,
        "output": 4.4,
        "cache_read": 0.275
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
      "provider": "openai",
      "path": "providers/openai/models/text-embedding-3-large",
      "digest": "fe08f80a8d382261737a6a1b5662fe22255ac0e754a1938dfa606ad3ee372c83"
    },
    "local": {
      "provider": "openai",
      "id": "text-embedding-3-large"
    },
    "apiID": "text-embedding-3-large",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "text-embedding-3-large",
      "description": "Embedding model for semantic search, retrieval, clustering, and ranking pipelines",
      "family": "text-embedding",
      "releaseDate": "2024-01-25",
      "lastUpdated": "2024-01-25",
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
        "context": 8191,
        "output": 3072
      },
      "cost": {
        "input": 0.13,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/text-embedding-3-small",
      "digest": "25f388f9917b6a91cb8685df7f9f5c0c1486cb842f4f5675e7b0679e13c13f6c"
    },
    "local": {
      "provider": "openai",
      "id": "text-embedding-3-small"
    },
    "apiID": "text-embedding-3-small",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "text-embedding-3-small",
      "description": "Embedding model for semantic search, retrieval, clustering, and ranking pipelines",
      "family": "text-embedding",
      "releaseDate": "2024-01-25",
      "lastUpdated": "2024-01-25",
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
        "context": 8191,
        "output": 1536
      },
      "cost": {
        "input": 0.02,
        "output": 0
      }
    },
    "unsupported": {}
  },
  {
    "source": {
      "provider": "openai",
      "path": "providers/openai/models/text-embedding-ada-002",
      "digest": "2157cd0c64aa41139eb93301baef6d001938f76db1f3c781f01783d5238773c3"
    },
    "local": {
      "provider": "openai",
      "id": "text-embedding-ada-002"
    },
    "apiID": "text-embedding-ada-002",
    "format": "openai",
    "lifecycle": "active",
    "metadata": {
      "name": "text-embedding-ada-002",
      "description": "Embedding model for semantic search, retrieval, clustering, and ranking pipelines",
      "family": "text-embedding",
      "releaseDate": "2022-12-15",
      "lastUpdated": "2022-12-15",
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
        "context": 8192,
        "output": 1536
      },
      "cost": {
        "input": 0.1,
        "output": 0
      }
    },
    "unsupported": {}
  }
] as const satisfies ReadonlyArray<GeneratedModel>
