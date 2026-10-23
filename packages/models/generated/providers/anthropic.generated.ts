import type { GeneratedModel } from "../../src/normalized.js"

export const models = [
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-fable-5",
      "digest": "a21d17eeeb6445308d76b1e3d1896997a4bb72951b4caeda1319c4706801d8b7"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-fable-5"
    },
    "apiID": "claude-fable-5",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Fable 5",
      "description": "Claude model for creative writing, analysis, and controlled agent workflows",
      "family": "claude-fable",
      "releaseDate": "2026-06-07",
      "lastUpdated": "2026-06-09",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 10,
        "output": 50,
        "cache_read": 1,
        "cache_write": 12.5
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-fable-5-1",
      "digest": "1f7a944ec4164bca6fcd20981e5c019446eac7517527d78214e7ebbf8b6e3e9b"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-fable-5-1"
    },
    "apiID": "claude-fable-5-1",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Fable 5.1",
      "description": "Claude model for demanding reasoning and long-horizon agentic work",
      "family": "claude-fable",
      "releaseDate": "2026-09-01",
      "lastUpdated": "2026-09-01",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 10,
        "output": 50,
        "cache_read": 0.25,
        "cache_write": 12.5
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-haiku-4-5",
      "digest": "43eca37b504dd7af3030e7ee7f9376107c02c352b912ef12cd7ac2274a2048f7"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-haiku-4-5"
    },
    "apiID": "claude-haiku-4-5",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Haiku 4.5 (latest)",
      "description": "Fast Claude lane for lightweight agents, office tasks, and responsive chat",
      "family": "claude-haiku",
      "releaseDate": "2025-10-15",
      "lastUpdated": "2025-10-15",
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
        "context": 200000,
        "output": 64000
      },
      "cost": {
        "input": 1,
        "output": 5,
        "cache_read": 0.1,
        "cache_write": 1.25
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-haiku-4-5-20251001",
      "digest": "88d65929e96e9d36fa42d6b9a65e582df2cbda17fab3bc2ac8ea45242541af2e"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-haiku-4-5-20251001"
    },
    "apiID": "claude-haiku-4-5-20251001",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Haiku 4.5",
      "description": "Fast Claude model for responsive assistance, classification, and lightweight agents",
      "family": "claude-haiku",
      "releaseDate": "2025-10-15",
      "lastUpdated": "2025-10-15",
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
        "context": 200000,
        "output": 64000
      },
      "cost": {
        "input": 1,
        "output": 5,
        "cache_read": 0.1,
        "cache_write": 1.25
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-opus-4-5",
      "digest": "c73fdf47dfa27dd0ad46f65e048e257aec3cb41316e6c656d15ff9635c7918da"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-opus-4-5"
    },
    "apiID": "claude-opus-4-5",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Opus 4.5 (latest)",
      "description": "Flagship Claude model for deep reasoning, coding, and long-horizon agents",
      "family": "claude-opus",
      "releaseDate": "2025-11-24",
      "lastUpdated": "2025-11-24",
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
        "context": 200000,
        "output": 64000
      },
      "cost": {
        "input": 5,
        "output": 25,
        "cache_read": 0.5,
        "cache_write": 6.25
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
        },
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-opus-4-5-20251101",
      "digest": "2b5070768fb2afc86c90bfa049a5f09b890741a2bfe8716a4953815d8898e025"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-opus-4-5-20251101"
    },
    "apiID": "claude-opus-4-5-20251101",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Opus 4.5",
      "description": "Flagship Claude model for deep reasoning, coding, and long-horizon agents",
      "family": "claude-opus",
      "releaseDate": "2025-11-24",
      "lastUpdated": "2025-11-01",
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
        "context": 200000,
        "output": 64000
      },
      "cost": {
        "input": 5,
        "output": 25,
        "cache_read": 0.5,
        "cache_write": 6.25
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
        },
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-opus-4-6",
      "digest": "e90b95d53594dc3022a0dd9b049901245c2bff6442324bf7a31d039821256df2"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-opus-4-6"
    },
    "apiID": "claude-opus-4-6",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Opus 4.6",
      "description": "High-end Claude for difficult coding, planning, and slower expert reasoning",
      "family": "claude-opus",
      "releaseDate": "2026-02-04",
      "lastUpdated": "2026-03-13",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 5,
        "output": 25,
        "cache_read": 0.5,
        "cache_write": 6.25
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high",
            "max"
          ]
        },
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-opus-4-7",
      "digest": "3bd0c4853edf7f6faa3e0c9c4be42f44afd7b78ffc0c90b925f2165932c6b224"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-opus-4-7"
    },
    "apiID": "claude-opus-4-7",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Opus 4.7",
      "description": "Stronger Opus tier for advanced software work and high-stakes reasoning",
      "family": "claude-opus",
      "releaseDate": "2026-04-14",
      "lastUpdated": "2026-04-16",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 5,
        "output": 25,
        "cache_read": 0.5,
        "cache_write": 6.25
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-opus-4-8",
      "digest": "8ca9ac22dcd1f9c1e8e9d57ea840cc1d48530f4e5d84988f1efcd6b35270dfc4"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-opus-4-8"
    },
    "apiID": "claude-opus-4-8",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Opus 4.8",
      "description": "Top Claude Opus tier for the hardest reasoning, coding, and long-horizon agents",
      "family": "claude-opus",
      "releaseDate": "2026-05-28",
      "lastUpdated": "2026-05-28",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 5,
        "output": 25,
        "cache_read": 0.5,
        "cache_write": 6.25
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
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
            "input": 10,
            "output": 50,
            "cache_read": 1,
            "cache_write": 12.5
          },
          "provider": {
            "body": {
              "speed": "fast"
            },
            "headers": {
              "anthropic-beta": "fast-mode-2026-02-01"
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-opus-5",
      "digest": "312957a87a81a54c88f67db5e7b67558386c71fc99ac2ab7db0859eac911f5e2"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-opus-5"
    },
    "apiID": "claude-opus-5",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Opus 5",
      "description": "Strongest Claude Opus model for coding, agents, and professional work",
      "family": "claude-opus",
      "releaseDate": "2026-07-24",
      "lastUpdated": "2026-07-24",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 5,
        "output": 25,
        "cache_read": 0.5,
        "cache_write": 6.25
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
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
            "input": 10,
            "output": 50,
            "cache_read": 1,
            "cache_write": 12.5
          },
          "provider": {
            "body": {
              "speed": "fast"
            },
            "headers": {
              "anthropic-beta": "fast-mode-2026-02-01"
            }
          }
        }
      }
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-sonnet-4-5",
      "digest": "ca87a42fab3b19d6692f99fb2e6219e4b87a29665d26e0885aeba17d166ab547"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-sonnet-4-5"
    },
    "apiID": "claude-sonnet-4-5",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Sonnet 4.5 (latest)",
      "description": "Balanced Claude model for coding, analysis, agent workflows, and cost control",
      "family": "claude-sonnet",
      "releaseDate": "2025-09-29",
      "lastUpdated": "2025-09-29",
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
        "context": 1000000,
        "output": 64000
      },
      "cost": {
        "input": 3,
        "output": 15,
        "cache_read": 0.3,
        "cache_write": 3.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-sonnet-4-5-20250929",
      "digest": "d2606431dd1fda34a8f591322dc509ffac6add6d8d732bcf18a57e60131a66be"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-sonnet-4-5-20250929"
    },
    "apiID": "claude-sonnet-4-5-20250929",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Sonnet 4.5",
      "description": "Balanced Claude model for coding, analysis, agent workflows, and cost control",
      "family": "claude-sonnet",
      "releaseDate": "2025-09-29",
      "lastUpdated": "2025-09-29",
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
        "context": 1000000,
        "output": 64000
      },
      "cost": {
        "input": 3,
        "output": 15,
        "cache_read": 0.3,
        "cache_write": 3.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-sonnet-4-6",
      "digest": "d2187eec5499bf3cb320c9e2a016bffeccf705f59918b5fe41b7bff6adaa3e96"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-sonnet-4-6"
    },
    "apiID": "claude-sonnet-4-6",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Sonnet 4.6",
      "description": "Claude workhorse for coding agents, careful analysis, and production cost control",
      "family": "claude-sonnet",
      "releaseDate": "2026-02-17",
      "lastUpdated": "2026-03-13",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 3,
        "output": 15,
        "cache_read": 0.3,
        "cache_write": 3.75
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high",
            "max"
          ]
        },
        {
          "type": "budget_tokens",
          "min": 1024
        }
      ]
    }
  },
  {
    "source": {
      "provider": "anthropic",
      "path": "providers/anthropic/models/claude-sonnet-5",
      "digest": "e93c85ffa0f0f186ad05f8c475f4b1796578181afcb2ba80cb85767540c9ed81"
    },
    "local": {
      "provider": "anthropic",
      "id": "claude-sonnet-5"
    },
    "apiID": "claude-sonnet-5",
    "format": "anthropic",
    "lifecycle": "active",
    "metadata": {
      "name": "Claude Sonnet 5",
      "description": "Everyday Claude agent model for coding, planning, browsing, and general work",
      "family": "claude-sonnet",
      "releaseDate": "2026-06-29",
      "lastUpdated": "2026-06-30",
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
        "context": 1000000,
        "output": 128000
      },
      "cost": {
        "input": 2,
        "output": 10,
        "cache_read": 0.2,
        "cache_write": 2.5
      }
    },
    "unsupported": {
      "reasoningOptions": [
        {
          "type": "toggle"
        },
        {
          "type": "effort",
          "values": [
            "low",
            "medium",
            "high",
            "xhigh",
            "max"
          ]
        }
      ]
    }
  }
] as const satisfies ReadonlyArray<GeneratedModel>
