import { createCanvas } from '@napi-rs/canvas';
import type { PortfolioSummary } from '../types/index.js';
import type { WalletSummary } from './wallet-tracker.js';
import type { SpotPrice } from './price-service.js';
import { getCryptoSymbol } from '../utils/crypto-mapper.js';

// =====================================================
// 🦍 IDM Image Generator
// Gera cards visuais com tema primata pro WhatsApp
// =====================================================

// Paleta de cores
const COLORS = {
  bg1: '#0a0e17',
  bg2: '#141b2d',
  bg3: '#1a2235',
  cardBg: '#1e2a3a',
  green: '#00d49f',
  greenDark: '#00a67d',
  greenBg: '#0a2e1a',
  red: '#ff4d6a',
  redDark: '#cc3d55',
  redBg: '#2e0a0a',
  gold: '#f7931a',
  blue: '#627eea',
  purple: '#9945ff',
  cyan: '#53bdeb',
  white: '#e9edef',
  gray: '#8b8fa3',
  grayDark: '#5a5e70',
  divider: 'rgba(255,255,255,0.06)',
};

// Crypto colors
const CRYPTO_COLORS: Record<string, string> = {
  bitcoin: '#f7931a',
  ethereum: '#627eea',
  solana: '#9945ff',
  binancecoin: '#f3ba2f',
  cardano: '#0033ad',
  ripple: '#23292f',
  polkadot: '#e6007a',
  avalanche: '#e84142',
  chainlink: '#2a5ada',
  'matic-network': '#8247e5',
  dogecoin: '#c2a633',
};

function getCryptoColor(cryptoId: string): string {
  return CRYPTO_COLORS[cryptoId] ?? '#53bdeb';
}

// Frases de primata por contexto
const MONKEY_PHRASES = {
  bigProfit: [
    'GORILA DIAMOND HANDS!',
    'Macaco esperto nao vende!',
    'APE TOGETHER STRONG!',
    'Esse primata ta rico!',
  ],
  smallProfit: [
    'Ta crescendo, macaco!',
    'Gorila paciente lucra!',
    'Banana a banana se enche!',
    'Segura firme, primata!',
  ],
  bigLoss: [
    'Nao olha nao...',
    'Gorila HODLer nao chora!',
    'E projeto de longo prazo...',
    'Calma, macaco. Calma.',
  ],
  smallLoss: [
    'So um arranhao!',
    'Gorila nao sente isso.',
    'Oscilacao e normal.',
    'Nada que assuste.',
  ],
  neutral: [
    'Gorila monitorando...',
    'Macaco de olho!',
    'Primata analisando.',
    'Status: observando.',
  ],
  wallet: [
    'Gorila ve tudo on-chain!',
    'Macaco rastreador!',
    'Nada escapa do primata.',
    'Blockchain do macaco.',
  ],
  price: [
    'Gorila ta de olho!',
    'Cotacao do macaco!',
    'Preco fresquinho!',
    'Primata informado.',
  ],
};

function getRandomPhrase(category: keyof typeof MONKEY_PHRASES): string {
  const phrases = MONKEY_PHRASES[category];
  return phrases[Math.floor(Math.random() * phrases.length)] ?? '🦍 Gorila monitorando...';
}

// Formatação
function fmtCurrency(value: number): string {
  if (value >= 1_000_000) return `R$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `R$${(value / 1_000).toFixed(1)}k`;
  return `R$${value.toFixed(2)}`;
}

function fmtPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function fmtCrypto(amount: number): string {
  if (amount >= 1) return amount.toFixed(4);
  if (amount >= 0.001) return amount.toFixed(6);
  return amount.toFixed(8);
}

// =====================================================
// Helpers de desenho
// =====================================================

function drawRoundedRect(
  ctx: any,
  x: number, y: number, w: number, h: number, r: number,
  fill?: string, stroke?: string
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawGradientBg(ctx: any, w: number, h: number, color1: string, color2: string) {
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, color1);
  grad.addColorStop(1, color2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawMiniBar(ctx: any, x: number, y: number, w: number, h: number, pct: number, color: string) {
  // Background bar
  drawRoundedRect(ctx, x, y, w, h, h / 2, 'rgba(255,255,255,0.05)');
  // Fill bar
  const fillW = Math.max(w * (pct / 100), h);
  drawRoundedRect(ctx, x, y, fillW, h, h / 2, color);
}

// =====================================================
// 📊 PORTFOLIO CARD
// =====================================================
export async function generatePortfolioCard(summary: PortfolioSummary): Promise<Buffer> {
  const W = 600;
  const holdings = summary.holdings;
  const rowH = 70;
  const headerH = 200;
  const footerH = 100;
  const H = headerH + holdings.length * rowH + footerH + 20;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  drawGradientBg(ctx, W, H, COLORS.bg1, COLORS.bg2);

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255,255,255,0.015)';
  ctx.lineWidth = 1;
  for (let i = 0; i < W; i += 30) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
  }
  for (let i = 0; i < H; i += 30) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
  }

  // Header area
  const isProfit = summary.total_profit_loss >= 0;
  const profitPct = summary.total_profit_loss_percent;
  let monkeyCategory: keyof typeof MONKEY_PHRASES;
  if (profitPct > 20) monkeyCategory = 'bigProfit';
  else if (profitPct > 0) monkeyCategory = 'smallProfit';
  else if (profitPct > -20) monkeyCategory = 'smallLoss';
  else monkeyCategory = 'bigLoss';

  // Monkey phrase
  const phrase = getRandomPhrase(monkeyCategory);
  ctx.font = '600 16px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.gray;
  ctx.fillText(phrase, 24, 36);

  // Brand
  ctx.font = '600 11px sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.textAlign = 'right';
  ctx.fillText('IDM PORTFOLIO', W - 24, 36);
  ctx.textAlign = 'left';

  // Total value
  ctx.font = '800 42px sans-serif';
  ctx.fillStyle = COLORS.white;
  ctx.fillText(fmtCurrency(summary.total_current_value), 24, 90);

  // P/L
  const plColor = isProfit ? COLORS.green : COLORS.red;
  const plIcon = isProfit ? '▲' : '▼';
  ctx.font = '700 20px sans-serif';
  ctx.fillStyle = plColor;
  ctx.fillText(
    `${plIcon} ${fmtCurrency(Math.abs(summary.total_profit_loss))} (${fmtPercent(profitPct)})`,
    24, 120
  );

  // Invested label
  ctx.font = '500 13px sans-serif';
  ctx.fillStyle = COLORS.gray;
  ctx.fillText(`Investido: ${fmtCurrency(summary.total_invested)}`, 24, 148);

  // Allocation bar (full width)
  const barY = 165;
  const barH = 10;
  const barW = W - 48;
  let barX = 24;
  drawRoundedRect(ctx, 24, barY, barW, barH, 5, 'rgba(255,255,255,0.05)');

  holdings.forEach((h, idx) => {
    const pct = h.current_value / summary.total_current_value;
    const segW = barW * pct;
    const color = getCryptoColor(h.crypto_id);
    // Add slight rounding on first and last segments
    const radius = idx === 0 || idx === holdings.length - 1 ? 5 : 0;
    drawRoundedRect(ctx, barX, barY, segW, barH, radius, color);
    barX += segW;
  });

  // Divider
  ctx.fillStyle = COLORS.divider;
  ctx.fillRect(24, headerH - 8, W - 48, 1);

  // Holdings rows
  holdings.forEach((h, i) => {
    const y = headerH + i * rowH;
    const symbol = getCryptoSymbol(h.crypto_id);
    const color = getCryptoColor(h.crypto_id);
    const holdProfit = h.profit_loss >= 0;
    const holdPct = h.profit_loss_percent;

    // Hover-like bg on alternating rows
    if (i % 2 === 0) {
      drawRoundedRect(ctx, 16, y, W - 32, rowH - 4, 8, 'rgba(255,255,255,0.02)');
    }

    // Crypto icon circle
    const circleX = 44;
    const circleY = y + rowH / 2;
    ctx.beginPath();
    ctx.arc(circleX, circleY, 18, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Symbol letter inside circle
    ctx.font = '800 14px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(symbol.charAt(0), circleX, circleY + 5);
    ctx.textAlign = 'left';

    // Symbol name
    ctx.font = '700 16px sans-serif';
    ctx.fillStyle = COLORS.white;
    ctx.fillText(symbol, 72, y + 28);

    // Amount
    ctx.font = '400 12px sans-serif';
    ctx.fillStyle = COLORS.gray;
    ctx.fillText(`${fmtCrypto(h.total_crypto)} ${symbol}`, 72, y + 48);

    // Value (right side)
    ctx.textAlign = 'right';
    ctx.font = '700 15px sans-serif';
    ctx.fillStyle = COLORS.white;
    ctx.fillText(fmtCurrency(h.current_value), W - 24, y + 28);

    // P/L percent
    ctx.font = '600 13px sans-serif';
    ctx.fillStyle = holdProfit ? COLORS.green : COLORS.red;
    ctx.fillText(fmtPercent(holdPct), W - 24, y + 48);
    ctx.textAlign = 'left';

    // Mini allocation bar
    const allocPct = (h.current_value / summary.total_current_value) * 100;
    drawMiniBar(ctx, 72, y + 56, 120, 4, allocPct, color);
  });

  // Footer
  const footerY = headerH + holdings.length * rowH + 10;
  ctx.fillStyle = COLORS.divider;
  ctx.fillRect(24, footerY, W - 48, 1);

  // Monkey watermark
  ctx.font = '500 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.textAlign = 'center';
  ctx.fillText('IDM Portfolio Bot -- Gorila nunca dorme', W / 2, footerY + 30);

  // Timestamp
  const now = new Date();
  const timeStr = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  ctx.font = '400 11px sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.fillText(`Atualizado às ${timeStr}`, W / 2, footerY + 50);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

// =====================================================
// 💰 PRICE CARD
// =====================================================
export async function generatePriceCard(spotPrice: SpotPrice): Promise<Buffer> {
  const W = 600;
  const H = 320;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const symbol = getCryptoSymbol(spotPrice.cryptoId);
  const color = getCryptoColor(spotPrice.cryptoId);
  const isUp = spotPrice.priceChangePercent24h >= 0;

  // Background with crypto-colored accent
  drawGradientBg(ctx, W, H, COLORS.bg1, COLORS.bg2);

  // Accent glow
  const glow = ctx.createRadialGradient(W * 0.7, H * 0.3, 0, W * 0.7, H * 0.3, 200);
  glow.addColorStop(0, `${color}15`);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Monkey phrase
  const phrase = getRandomPhrase('price');
  ctx.font = '600 14px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.gray;
  ctx.fillText(phrase, 24, 34);

  // Crypto circle
  ctx.beginPath();
  ctx.arc(50, 80, 24, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.font = '800 18px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(symbol.charAt(0), 50, 87);
  ctx.textAlign = 'left';

  // Crypto name
  ctx.font = '800 28px sans-serif';
  ctx.fillStyle = COLORS.white;
  ctx.fillText(symbol, 86, 88);

  // Price (large)
  ctx.font = '800 48px sans-serif';
  ctx.fillStyle = COLORS.white;
  ctx.fillText(fmtCurrency(spotPrice.price), 24, 160);

  // 24h change
  const changeIcon = isUp ? '▲' : '▼';
  ctx.font = '700 22px sans-serif';
  ctx.fillStyle = isUp ? COLORS.green : COLORS.red;
  ctx.fillText(`${changeIcon} ${fmtPercent(spotPrice.priceChangePercent24h)} (24h)`, 24, 195);

  // Decorative fake chart
  ctx.beginPath();
  ctx.strokeStyle = `${color}40`;
  ctx.lineWidth = 2;
  const chartY = 230;
  const chartH = 50;
  const points: [number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const x = 24 + (i / 19) * (W - 48);
    const seed = Math.sin(i * 0.8 + spotPrice.price * 0.0001) * 0.5 + 0.5;
    const trend = isUp ? (i / 19) * 0.3 : -(i / 19) * 0.3;
    const y = chartY + chartH * (0.5 - seed * 0.8 - trend);
    points.push([x, y]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Fill under chart
  ctx.lineTo(W - 24, chartY + chartH);
  ctx.lineTo(24, chartY + chartH);
  ctx.closePath();
  const chartGrad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
  chartGrad.addColorStop(0, `${color}15`);
  chartGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = chartGrad;
  ctx.fill();

  // Footer
  ctx.font = '500 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.textAlign = 'center';
  ctx.fillText('IDM Portfolio Bot', W / 2, H - 16);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

// =====================================================
// 👛 WALLET CARD
// =====================================================
export async function generateWalletCard(summary: WalletSummary): Promise<Buffer> {
  const W = 600;
  const rowH = 55;
  const headerH = 160;
  const H = headerH + Math.max(summary.balances.length, 1) * rowH + 60;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawGradientBg(ctx, W, H, '#0a1628', '#162040');

  // Monkey phrase
  const phrase = getRandomPhrase('wallet');
  ctx.font = '600 14px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.gray;
  ctx.fillText(phrase, 24, 34);

  // Brand
  ctx.font = '600 11px sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.textAlign = 'right';
  ctx.fillText('ON-CHAIN', W - 24, 34);
  ctx.textAlign = 'left';

  // Chain badge
  const chainNames: Record<string, string> = {
    bitcoin: 'BTC - Bitcoin', ethereum: 'ETH - Ethereum',
    solana: 'SOL - Solana', base: 'BASE - Base'
  };
  const chainColors: Record<string, string> = {
    bitcoin: '#f7931a', ethereum: '#627eea',
    solana: '#9945ff', base: '#0052ff'
  };
  const chainName = chainNames[summary.chain] ?? summary.chain;
  const chainColor = chainColors[summary.chain] ?? COLORS.cyan;

  drawRoundedRect(ctx, 24, 48, 140, 28, 14, `${chainColor}25`);
  ctx.font = '600 13px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = chainColor;
  ctx.fillText(chainName, 38, 67);

  // Address
  const shortAddr = summary.address.length > 12
    ? `${summary.address.slice(0, 8)}...${summary.address.slice(-6)}`
    : summary.address;
  ctx.font = '400 14px monospace';
  ctx.fillStyle = COLORS.gray;
  ctx.fillText(`${shortAddr}`, 24, 100);

  // Label
  if (summary.label) {
    ctx.font = '500 13px sans-serif';
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText(`${summary.label}`, 24, 122);
  }

  // Total value
  ctx.font = '800 36px sans-serif';
  ctx.fillStyle = COLORS.white;
  ctx.fillText(`~${fmtCurrency(summary.totalBrl)}`, 24, headerH - 5);

  // Divider
  ctx.fillStyle = COLORS.divider;
  ctx.fillRect(24, headerH + 2, W - 48, 1);

  // Balances
  if (summary.balances.length === 0) {
    ctx.font = '500 16px sans-serif';
    ctx.fillStyle = COLORS.grayDark;
    ctx.textAlign = 'center';
    ctx.fillText('Carteira vazia', W / 2, headerH + 40);
    ctx.textAlign = 'left';
  } else {
    summary.balances.forEach((b, i) => {
      const y = headerH + 12 + i * rowH;
      const color = getCryptoColor(b.cryptoId);

      // Circle
      ctx.beginPath();
      ctx.arc(44, y + 22, 16, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.font = '700 12px sans-serif';
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(b.symbol.charAt(0), 44, y + 27);
      ctx.textAlign = 'left';

      // Symbol + amount
      ctx.font = '700 15px sans-serif';
      ctx.fillStyle = COLORS.white;
      ctx.fillText(b.symbol, 70, y + 18);
      ctx.font = '400 12px sans-serif';
      ctx.fillStyle = COLORS.gray;
      ctx.fillText(`${fmtCrypto(b.balance)} ${b.symbol}`, 70, y + 38);

      // Value
      ctx.textAlign = 'right';
      ctx.font = '700 15px sans-serif';
      ctx.fillStyle = COLORS.white;
      ctx.fillText(`~${fmtCurrency(b.valueBrl)}`, W - 24, y + 28);
      ctx.textAlign = 'left';
    });
  }

  // Footer
  ctx.font = '500 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.textAlign = 'center';
  ctx.fillText('IDM Portfolio Bot', W / 2, H - 16);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

// =====================================================
// 😂 MEME CARD (Profit/Loss reactions)
// =====================================================
export async function generateMemeCard(
  profitLossPercent: number,
  totalValue: number,
  profitLoss: number
): Promise<Buffer> {
  const W = 600;
  const H = 400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const isProfit = profitLossPercent >= 0;
  const isBig = Math.abs(profitLossPercent) > 20;

  // Background
  if (isProfit) {
    drawGradientBg(ctx, W, H, '#041a0e', '#0a3d1f');
  } else {
    drawGradientBg(ctx, W, H, '#1a0404', '#3d0a0a');
  }

  // Huge ASCII art center
  const topText = isProfit
    ? (isBig ? 'APE MODE ON' : 'GORILA WINS')
    : (isBig ? 'HODL HODL HODL' : 'ZEN GORILA');

  ctx.font = '900 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = isProfit ? `${COLORS.green}90` : `${COLORS.red}90`;
  ctx.fillText(topText, W / 2, 100);

  // Big P/L text
  ctx.font = '900 52px sans-serif';
  ctx.fillStyle = isProfit ? COLORS.green : COLORS.red;
  ctx.fillText(fmtPercent(profitLossPercent), W / 2, 185);

  // Value
  ctx.font = '600 24px sans-serif';
  ctx.fillStyle = COLORS.white;
  ctx.fillText(fmtCurrency(totalValue), W / 2, 225);

  // P/L absolute
  ctx.font = '500 18px sans-serif';
  ctx.fillStyle = isProfit ? COLORS.green : COLORS.red;
  const plSign = isProfit ? '+' : '-';
  ctx.fillText(`${plSign}${fmtCurrency(Math.abs(profitLoss))}`, W / 2, 255);

  // Funny quote
  const quotes = isProfit
    ? (isBig ? [
        '"Eu sempre soube" — Todo gorila após o pump',
        '"Compra mais?" — Gorila insaciável',
        '"Lambo quando?" — Macaco ansioso',
        '"Não era sorte, era tese" — Primata convicto',
      ] : [
        '"Devagar se vai ao longe" — Macaco paciente',
        '"Tá no lucro, tá feliz" — Primata zen',
        '"Banana por banana" — Gorila satisfeito',
      ])
    : (isBig ? [
        '"É projeto de longo prazo" — Gorila copando',
        '"Só perde quem vende" — Macaco teimoso',
        '"DCA é o caminho" — Primata esperançoso',
        '"Comprar o dip do dip" — Gorila otimista',
      ] : [
        '"Oscilação normal" — Macaco tranquilo',
        '"Já vi coisa pior" — Gorila calejado',
        '"HODL e segue" — Primata disciplinado',
      ]);

  const quote = quotes[Math.floor(Math.random() * quotes.length)] ?? '🦍 Gorila segue firme!';
  ctx.font = 'italic 500 16px sans-serif';
  ctx.fillStyle = isProfit ? '#6ee7b7' : '#fca5a5';
  ctx.fillText(quote, W / 2, 305);

  // Footer
  ctx.fillStyle = COLORS.divider;
  ctx.fillRect(W * 0.2, 340, W * 0.6, 1);

  ctx.font = '500 13px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillStyle = COLORS.grayDark;
  ctx.fillText('IDM Portfolio Bot -- Gorila nunca dorme', W / 2, 370);
  ctx.textAlign = 'left';

  return canvas.toBuffer('image/png');
}

// =====================================================
// Decide se deve gerar meme (só em lucros/perdas significativos)
// =====================================================
export function shouldGenerateMeme(profitLossPercent: number): boolean {
  return Math.abs(profitLossPercent) > 10;
}
