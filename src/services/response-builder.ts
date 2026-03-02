import type {
  HoldingWithCurrentValue,
  PortfolioSummary,
} from '../types/index.js';
import type { BuyResult, SellResult, DcaProgress, Projection } from './portfolio.js';
import type { SpotPrice } from './price-service.js';
import type { WalletSummary } from './wallet-tracker.js';
import type { Wallet } from '../database/repositories/wallet.repo.js';
import {
  formatCurrency,
  formatCryptoAmount,
  formatPercent,
  formatProfitLoss,
  formatPriceWithChange,
  progressBar,
} from '../utils/formatters.js';
import { getCryptoDisplayName, getCryptoSymbol } from '../utils/crypto-mapper.js';
import { formatAddress, formatChainName } from './wallet-tracker.js';

export function buildBuyConfirmation(result: BuyResult): string {
  const symbol = getCryptoSymbol(result.cryptoId);

  return `✅ *Compra registrada!*

💰 ${formatCurrency(result.amountFiat)} → ${formatCryptoAmount(result.amountCrypto)} ${symbol}
📊 Preço: ${formatCurrency(result.priceAtTransaction)}/${symbol}

*Posição atualizada:*
📦 Total: ${formatCryptoAmount(result.newTotalCrypto)} ${symbol}
📈 PM: ${formatCurrency(result.newAveragePrice)}`;
}

export function buildSellConfirmation(result: SellResult): string {
  const symbol = getCryptoSymbol(result.cryptoId);
  const profitEmoji = result.profit >= 0 ? '🟢' : '🔴';

  return `✅ *Venda registrada!*

💵 ${formatCryptoAmount(result.amountCrypto)} ${symbol} → ${formatCurrency(result.amountFiat)}
📊 Preço: ${formatCurrency(result.priceAtTransaction)}/${symbol}

*Resultado:*
${profitEmoji} ${result.profit >= 0 ? 'Lucro' : 'Prejuízo'}: ${formatCurrency(Math.abs(result.profit))} (${formatPercent(result.profitPercent)})

📦 Restante: ${formatCryptoAmount(result.remainingCrypto)} ${symbol}`;
}

export function buildPortfolioSummary(summary: PortfolioSummary): string {
  if (summary.holdings.length === 0) {
    return `📊 *Sua Carteira*

Você ainda não possui nenhum ativo registrado.

💡 Envie "comprei X de BTC" para começar!`;
  }

  const holdingsText = summary.holdings
    .map((h) => {
      const symbol = getCryptoSymbol(h.crypto_id);
      const profitEmoji = h.profit_loss >= 0 ? '🟢' : '🔴';
      return `*${symbol}*: ${formatCryptoAmount(h.total_crypto)}
   💵 ${formatCurrency(h.current_value)} ${profitEmoji} ${formatPercent(h.profit_loss_percent)}`;
    })
    .join('\n\n');

  const totalProfitEmoji = summary.total_profit_loss >= 0 ? '📈' : '📉';

  return `📊 *Sua Carteira*

${holdingsText}

━━━━━━━━━━━━━━━
💰 *Investido:* ${formatCurrency(summary.total_invested)}
💎 *Valor atual:* ${formatCurrency(summary.total_current_value)}
${totalProfitEmoji} *P/L:* ${formatProfitLoss(summary.total_profit_loss, summary.total_profit_loss_percent)}`;
}

export function buildAssetDetail(holding: HoldingWithCurrentValue): string {
  const name = getCryptoDisplayName(holding.crypto_id);
  const symbol = getCryptoSymbol(holding.crypto_id);
  const profitEmoji = holding.profit_loss >= 0 ? '🟢' : '🔴';

  return `📊 *${name} (${symbol})*

📦 *Quantidade:* ${formatCryptoAmount(holding.total_crypto)} ${symbol}
💵 *Valor investido:* ${formatCurrency(holding.total_invested)}
📈 *Preço médio:* ${formatCurrency(holding.average_price)}

💰 *Preço atual:* ${formatCurrency(holding.current_price)}
💎 *Valor atual:* ${formatCurrency(holding.current_value)}

${profitEmoji} *P/L:* ${formatProfitLoss(holding.profit_loss, holding.profit_loss_percent)}`;
}

export function buildPriceCheck(price: SpotPrice): string {
  const name = getCryptoDisplayName(price.cryptoId);
  const symbol = getCryptoSymbol(price.cryptoId);

  return `💰 *${name} (${symbol})*

${formatPriceWithChange(price.price, price.priceChangePercent24h)}`;
}

export function buildRemoveAssetConfirmation(
  cryptoId: string,
  amountRemoved: number,
  valueAtRemoval: number
): string {
  const name = getCryptoDisplayName(cryptoId);
  const symbol = getCryptoSymbol(cryptoId);

  return `🗑️ *Ativo removido!*

${name} (${symbol}) foi removido da sua carteira.
📦 ${formatCryptoAmount(amountRemoved)} ${symbol}
💵 Valor: ${formatCurrency(valueAtRemoval)}`;
}

export function buildDcaGoalSet(cryptoId: string, goalAmount: number): string {
  const name = getCryptoDisplayName(cryptoId);
  const symbol = getCryptoSymbol(cryptoId);

  return `🎯 *Meta DCA definida!*

${name} (${symbol}): ${formatCurrency(goalAmount)}

💡 Envie "progresso" para acompanhar suas metas.`;
}

export function buildDcaProgress(progress: DcaProgress[]): string {
  if (progress.length === 0) {
    return `🎯 *Metas DCA*

Você ainda não definiu nenhuma meta.

💡 Envie "meta 10000 em BTC" para criar uma meta.`;
  }

  const progressText = progress
    .map((p) => {
      const symbol = getCryptoSymbol(p.cryptoId);
      const bar = progressBar(p.progressPercent);
      const status = p.progressPercent >= 100 ? '✅' : '🔄';

      return `*${symbol}* ${status}
${bar} ${formatPercent(p.progressPercent)}
💵 ${formatCurrency(p.currentInvested)} / ${formatCurrency(p.goalAmount)}
📌 Falta: ${formatCurrency(p.remaining)}`;
    })
    .join('\n\n');

  return `🎯 *Progresso DCA*

${progressText}`;
}

export function buildProjection(projection: Projection, currentValue: number): string {
  const { scenarios } = projection;

  return `🔮 *Projeção ${projection.months} meses*

📊 Valor atual: ${formatCurrency(currentValue)}

*Cenários:*
🔴 Pessimista: ${formatCurrency(scenarios.pessimistic.value)}
🟡 Moderado: ${formatCurrency(scenarios.moderate.value)}
🟢 Otimista: ${formatCurrency(scenarios.optimistic.value)}

⚠️ _Projeções baseadas em médias históricas. Não é garantia de retorno._`;
}

export function buildHelp(): string {
  return `📚 *Comandos disponíveis*

*Registrar transações:*
• "comprei 500 de btc"
• "vendi 0.5 eth por 5000"

*Ver carteira:*
• "carteira" - resumo geral
• "quanto tenho de btc" - detalhe

*Cotações:*
• "preço do eth"

*Gerenciar ativos:*
• "remover btc" - zera posição

*Metas DCA:*
• "meta 10000 em btc"
• "progresso"

*Projeções:*
• "projeção 12 meses"

*Criptos suportadas:*
BTC, ETH, SOL, BNB, ADA, XRP, DOT, AVAX, LINK, MATIC, DOGE, e mais!`;
}

export function buildOnboarding(name?: string): string {
  const greeting = name ? `E ai, ${name}!` : 'E ai!';

  return `${greeting} Sou o IDM — teu portfolio crypto no WhatsApp.

Testa agora: manda *comprei 500 de btc*`;
}

// After first buy — guide to aha moment
export function buildOnboardingStep2(): string {
  return `Agora manda *carteira* pra ver teu portfolio visual.`;
}

// After first portfolio view — hook complete
export function buildOnboardingStep3(): string {
  return `Cola um endereco de wallet (BTC, ETH ou SOL) pra rastrear on-chain tambem.

Manda *ajuda* se quiser ver tudo que eu faco.`;
}

export function buildError(message: string): string {
  return `❌ *Ops!*

${message}

💡 Envie "ajuda" para ver os comandos disponíveis.`;
}

export function buildUnknownIntent(): string {
  return `🤔 Não entendi sua mensagem.

Tente algo como:
• "comprei 500 de btc"
• "carteira"
• "preço do eth"

💡 Envie "ajuda" para ver todos os comandos.`;
}

export function buildRateLimited(): string {
  return `⏳ *Calma aí!*

Você está enviando muitas mensagens. Aguarde um momento antes de tentar novamente.`;
}

export function buildAssetNotFound(cryptoId: string): string {
  const symbol = getCryptoSymbol(cryptoId);
  return `❌ Você não possui ${symbol} na carteira.

💡 Envie "comprei X de ${symbol}" para começar.`;
}

export function buildCryptoNotSupported(input: string): string {
  return `❌ Cripto "${input}" não reconhecida.

💡 Tente usar símbolos como BTC, ETH, SOL, etc.`;
}

// =====================================================
// Wallet Tracking Responses
// =====================================================

export function buildWalletAdded(summary: WalletSummary): string {
  const chainName = formatChainName(summary.chain);
  const addr = formatAddress(summary.address);

  if (summary.balances.length === 0) {
    return `👛 *Wallet adicionada!*\n\n${chainName}\n📍 ${addr}\n\n💰 Saldo: vazio (0)\n\n💡 Envie "minhas wallets" para ver todas.`;
  }

  const balancesText = summary.balances
    .map((b) => `   ${b.symbol}: ${formatCryptoAmount(b.balance)} (~R$${b.valueBrl.toFixed(2)})`)
    .join('\n');

  return `👛 *Wallet adicionada!*\n\n${chainName}\n📍 ${addr}\n\n💰 *Saldos:*\n${balancesText}\n\n💎 *Total:* ~R$${summary.totalBrl.toFixed(2)}\n\n💡 Envie "minhas wallets" para ver todas.`;
}

export function buildWalletBalance(summary: WalletSummary): string {
  const chainName = formatChainName(summary.chain);
  const addr = formatAddress(summary.address);

  if (summary.balances.length === 0) {
    return `👛 ${chainName}\n📍 ${addr}\n${summary.label ? `🏷️ ${summary.label}\n` : ''}\n💰 Saldo: vazio`;
  }

  const balancesText = summary.balances
    .map((b) => `   ${b.symbol}: ${formatCryptoAmount(b.balance)} (~R$${b.valueBrl.toFixed(2)})`)
    .join('\n');

  return `👛 ${chainName}\n📍 ${addr}\n${summary.label ? `🏷️ ${summary.label}\n` : ''}\n💰 *Saldos:*\n${balancesText}\n\n💎 *Total:* ~R$${summary.totalBrl.toFixed(2)}`;
}

export function buildWalletList(wallets: Wallet[], summaries: WalletSummary[]): string {
  if (wallets.length === 0) {
    return `👛 *Minhas Wallets*\n\nNenhuma wallet monitorada.\n\n💡 Cole um endereço BTC, ETH ou SOL para começar!`;
  }

  let grandTotalBrl = 0;

  const walletsText = summaries
    .map((s) => {
      grandTotalBrl += s.totalBrl;
      const chainName = formatChainName(s.chain);
      const addr = formatAddress(s.address);
      const label = s.label ? ` (${s.label})` : '';
      const balanceText = s.balances.length > 0
        ? s.balances.map((b) => `${b.symbol}: ${formatCryptoAmount(b.balance)}`).join(', ')
        : 'vazio';

      return `${chainName}${label}\n   📍 ${addr}\n   💰 ${balanceText} (~R$${s.totalBrl.toFixed(2)})`;
    })
    .join('\n\n');

  return `👛 *Minhas Wallets* (${wallets.length})\n\n${walletsText}\n\n━━━━━━━━━━━━━━━\n💎 *Total on-chain:* ~R$${grandTotalBrl.toFixed(2)}`;
}

export function buildWalletRemoved(address: string): string {
  return `🗑️ Wallet ${formatAddress(address)} removida.`;
}

export function buildWalletNotFound(address: string): string {
  return `❌ Wallet ${formatAddress(address)} não encontrada na sua lista.\n\n💡 Envie "minhas wallets" para ver suas wallets.`;
}

export function buildWalletLimitReached(): string {
  return `❌ Limite de wallets atingido (máximo 5).\n\n💡 Remova uma wallet com "remover wallet 0x..." antes de adicionar outra.`;
}

export function buildInvalidAddress(): string {
  return `❌ Endereço inválido.\n\n💡 Formatos aceitos:\n• Bitcoin: 1..., 3..., bc1...\n• Ethereum: 0x...\n• Solana: endereço Base58`;
}
