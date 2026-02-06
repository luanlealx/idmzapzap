# IDM ZapZap - Diagrama de Arquitetura

## Visao Geral do Sistema

Bot de WhatsApp para rastreamento de portfolio de criptomoedas, construido com Node.js/TypeScript, usando Claude AI para processamento de linguagem natural.

---

## Arquitetura Geral

```mermaid
graph TB
    subgraph Usuario
        WA[WhatsApp do Usuario]
    end

    subgraph "Evolution API (WhatsApp Gateway)"
        EVO[Evolution API v1.8.7]
    end

    subgraph "IDM Bot - Fastify Server :3000"
        direction TB
        WH[Webhook Handler<br/>POST /webhook/evolution]
        RL[Rate Limiter<br/>10 msgs/min por usuario]
        MR[Message Router]
        IP[Intent Parser]
        PS[Portfolio Service]
        RB[Response Builder]
        WS[WhatsApp Service]
    end

    subgraph "Servicos Externos"
        CLAUDE[Anthropic Claude AI<br/>Haiku - NLP]
        CG[CoinGecko API<br/>Precos Cripto]
    end

    subgraph "Banco de Dados"
        SB[(Supabase<br/>PostgreSQL)]
    end

    WA -->|Mensagem| EVO
    EVO -->|Webhook POST| WH
    WH --> RL
    RL --> MR
    MR --> IP
    IP -->|Parsing de Intencao| CLAUDE
    MR --> PS
    PS -->|Precos em Tempo Real| CG
    PS -->|CRUD| SB
    MR --> RB
    RB --> WS
    WS -->|Enviar Resposta| EVO
    EVO -->|Mensagem| WA
```

---

## Fluxo de Processamento de Mensagens

```mermaid
sequenceDiagram
    participant U as Usuario (WhatsApp)
    participant E as Evolution API
    participant W as Webhook Handler
    participant R as Rate Limiter
    participant M as Message Router
    participant I as Intent Parser
    participant C as Claude AI
    participant P as Portfolio Service
    participant CG as CoinGecko
    participant DB as Supabase (PostgreSQL)
    participant RB as Response Builder
    participant WS as WhatsApp Service

    U->>E: Envia mensagem<br/>"comprei 500 de btc"
    E->>W: POST /webhook/evolution/messages-upsert
    W-->>E: 200 OK (resposta imediata)

    Note over W: Processamento assincrono

    W->>R: Verificar rate limit
    R-->>W: Permitido

    W->>M: processMessage(phone, text)
    M->>DB: findOrCreateUser(phone)
    DB-->>M: User {id, phone}

    M->>I: parseIntent("comprei 500 de btc")
    I->>C: Classificar intencao via LLM
    C-->>I: {intent: buy, crypto: bitcoin, amount: 500}
    I-->>M: ParsedIntent

    M->>P: registerBuy(userId, bitcoin, 500)
    P->>CG: getPrice(bitcoin, brl)
    CG-->>P: R$ 350.000,00
    P->>DB: createTransaction(buy, 500, 0.00142857)
    Note over DB: Materialized View<br/>user_holdings atualizada<br/>automaticamente
    DB-->>P: Transaction criada
    P-->>M: BuyResult

    M->>RB: buildBuyConfirmation(result)
    RB-->>M: Mensagem formatada

    M->>WS: sendMessage(phone, mensagem)
    WS->>E: POST /chat/presence (typing...)
    Note over WS: Delay humanizado 1-3s
    WS->>E: POST /message/sendText
    E->>U: Resposta formatada
```

---

## Modelo de Dados (Banco de Dados)

```mermaid
erDiagram
    users {
        uuid id PK
        varchar phone_number UK "Numero WhatsApp"
        varchar name "Nome opcional"
        timestamp created_at
        timestamp updated_at
    }

    transactions {
        uuid id PK
        uuid user_id FK "Referencia users"
        varchar crypto_id "ID CoinGecko ex: bitcoin"
        enum type "buy | sell"
        decimal amount_fiat "Valor em BRL"
        decimal amount_crypto "Quantidade cripto"
        decimal price_at_transaction "Preco unitario"
        timestamp created_at
    }

    user_holdings {
        uuid user_id FK "Materialized View"
        varchar crypto_id "ID CoinGecko"
        decimal total_crypto "Soma compras - vendas"
        decimal total_invested "Total investido BRL"
        decimal average_price "Preco medio"
    }

    dca_goals {
        uuid id PK
        uuid user_id FK "Referencia users"
        varchar crypto_id "ID CoinGecko"
        decimal goal_amount "Meta em BRL"
        timestamp created_at
        timestamp updated_at
    }

    price_alerts {
        uuid id PK
        uuid user_id FK "Referencia users"
        varchar crypto_id "ID CoinGecko"
        decimal target_price "Preco alvo"
        enum alert_type "above | below"
        boolean is_triggered
        timestamp created_at
        timestamp triggered_at
    }

    users ||--o{ transactions : "registra"
    users ||--o{ user_holdings : "possui"
    users ||--o{ dca_goals : "define"
    users ||--o{ price_alerts : "configura"
```

---

## Estrutura de Diretorios

```mermaid
graph LR
    subgraph "src/"
        direction TB
        IDX[index.ts<br/>Entry Point]

        subgraph "config/"
            ENV[env.ts<br/>Variaveis de Ambiente]
        end

        subgraph "webhooks/"
            EVOW[evolution.ts<br/>Handler de Webhook]
        end

        subgraph "services/"
            MR2[message-router.ts<br/>Roteador]
            IP2[intent-parser.ts<br/>NLP com Claude]
            PORT[portfolio.ts<br/>Logica de Negocios]
            PRICE[price-service.ts<br/>Precos CoinGecko]
            WHATS[whatsapp.ts<br/>Envio de Msgs]
            RESP[response-builder.ts<br/>Formatacao]
        end

        subgraph "database/"
            CLIENT[client.ts<br/>Supabase Client]
            subgraph "repositories/"
                UREPO[user.repo.ts]
                TREPO[transaction.repo.ts]
                PREPO[portfolio.repo.ts]
            end
            subgraph "migrations/"
                MIG[001_initial.sql]
            end
        end

        subgraph "utils/"
            CRYPTO[crypto-mapper.ts<br/>Aliases Cripto]
            FMT[formatters.ts<br/>Formatacao BRL]
            RATE[rate-limiter.ts<br/>Limite de Taxa]
        end

        subgraph "types/"
            TYPES[index.ts<br/>Interfaces TS]
        end
    end
```

---

## Intencoes Suportadas (Comandos do Bot)

```mermaid
graph TD
    MSG[Mensagem do Usuario] --> IP3[Intent Parser]

    IP3 --> BUY[buy<br/>Registrar compra<br/>'comprei 500 de btc']
    IP3 --> SELL[sell<br/>Registrar venda<br/>'vendi 0.5 eth por 5000']
    IP3 --> PORT2[portfolio_summary<br/>Ver carteira<br/>'carteira / portfolio']
    IP3 --> ASSET[asset_detail<br/>Detalhe do ativo<br/>'quanto tenho de btc']
    IP3 --> PCHK[price_check<br/>Verificar preco<br/>'preco do eth']
    IP3 --> REM[remove_asset<br/>Remover ativo<br/>'zerar posicao btc']
    IP3 --> SDCA[set_dca_goal<br/>Definir meta DCA<br/>'meta 10000 em btc']
    IP3 --> PDCA[dca_progress<br/>Progresso metas<br/>'progresso / metas']
    IP3 --> PROJ[projection<br/>Projecao 12 meses<br/>'projecao']
    IP3 --> ALERT[set_alert<br/>Alerta de preco<br/>'alerta btc acima 500k']
    IP3 --> HELP[help<br/>Ajuda<br/>'ajuda / comandos']
    IP3 --> UNK[unknown<br/>Nao reconhecido]

    style BUY fill:#2d6a4f,color:#fff
    style SELL fill:#d62828,color:#fff
    style PORT2 fill:#1d3557,color:#fff
    style ASSET fill:#457b9d,color:#fff
    style PCHK fill:#e9c46a,color:#000
    style REM fill:#9b2226,color:#fff
    style SDCA fill:#606c38,color:#fff
    style PDCA fill:#283618,color:#fff
    style PROJ fill:#6a4c93,color:#fff
    style ALERT fill:#f4a261,color:#000
    style HELP fill:#264653,color:#fff
    style UNK fill:#6c757d,color:#fff
```

---

## Infraestrutura Docker

```mermaid
graph TB
    subgraph "Docker Compose - idm-network"
        subgraph "bot :3000"
            BOT[Node.js 20 Alpine<br/>IDM Bot<br/>Fastify Server]
        end

        subgraph "evolution :8080"
            EVOS[Evolution API v1.8.7<br/>WhatsApp Gateway]
        end

        subgraph "postgres :5432"
            PG[(PostgreSQL 16<br/>Alpine)]
        end
    end

    subgraph "Servicos Externos"
        SB2[Supabase Cloud<br/>PostgreSQL + REST API]
        ANT[Anthropic API<br/>Claude Haiku]
        CGK[CoinGecko API<br/>Precos Cripto]
        WAP[WhatsApp<br/>Meta Servers]
    end

    BOT -->|Webhook| EVOS
    EVOS -->|WhatsApp Protocol| WAP
    BOT -->|REST API| SB2
    BOT -->|LLM API| ANT
    BOT -->|Price API| CGK
    EVOS -.->|Opcional| PG
```

---

## Camadas da Arquitetura

```mermaid
graph TB
    subgraph "Camada de Apresentacao"
        WH3[Webhook Handler]
        RB3[Response Builder]
        WS3[WhatsApp Service]
    end

    subgraph "Camada de Negocios"
        MR3[Message Router]
        IP4[Intent Parser]
        PS3[Portfolio Service]
        PRS[Price Service]
    end

    subgraph "Camada de Dados"
        UR[User Repository]
        TR[Transaction Repository]
        PR[Portfolio Repository]
    end

    subgraph "Camada de Infraestrutura"
        DB3[(Supabase PostgreSQL)]
        CACHE[Cache em Memoria<br/>Precos: 60s TTL]
        RL3[Rate Limiter<br/>Sliding Window]
    end

    WH3 --> MR3
    MR3 --> IP4
    MR3 --> PS3
    PS3 --> PRS
    MR3 --> RB3
    RB3 --> WS3

    IP4 -.->|Claude AI| EXT1[API Externa]
    PRS -.->|CoinGecko| EXT2[API Externa]

    PS3 --> UR
    PS3 --> TR
    PS3 --> PR

    UR --> DB3
    TR --> DB3
    PR --> DB3
    PRS --> CACHE
    MR3 --> RL3
```

---

## Stack Tecnologica

| Camada | Tecnologia | Proposito |
|--------|-----------|-----------|
| **Runtime** | Node.js 20 | Ambiente de execucao |
| **Linguagem** | TypeScript 5.7 | Tipagem estatica |
| **HTTP Server** | Fastify 5.2 | Servidor web leve |
| **Banco de Dados** | Supabase (PostgreSQL) | Persistencia de dados |
| **NLP/AI** | Anthropic Claude Haiku | Parsing de intencoes |
| **WhatsApp** | Evolution API v1.8.7 | Gateway WhatsApp |
| **Precos** | CoinGecko API | Cotacoes de cripto |
| **Testes** | Vitest | Testes unitarios |
| **Container** | Docker + Compose | Deploy e orquestracao |

---

## Criptomoedas Suportadas

30+ criptomoedas com aliases em portugues:

**Majors:** BTC, ETH, SOL, BNB, ADA, XRP, DOT, AVAX, LINK
**DeFi:** UNI, AAVE, MATIC
**Layer 2:** ARB, OP
**Alt L1:** NEAR, APT, SUI
**Meme:** DOGE, SHIB, PEPE
**Stablecoins:** USDT, USDC
**Outros:** LTC, ATOM, XLM, XMR, TRX, RNDR, INJ, SEI, JUP
