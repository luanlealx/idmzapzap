// Currency formatter for BRL
const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const brlCompactFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

// Crypto amount formatter (variable precision based on value)
function getCryptoFormatter(value: number): Intl.NumberFormat {
  let decimals: number;
  if (value >= 1000) {
    decimals = 2;
  } else if (value >= 1) {
    decimals = 4;
  } else if (value >= 0.001) {
    decimals = 6;
  } else {
    decimals = 8;
  }

  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

// Percentage formatter
const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'always',
});

export function formatCurrency(value: number): string {
  return brlFormatter.format(value);
}

export function formatCurrencyCompact(value: number): string {
  if (value < 10000) {
    return formatCurrency(value);
  }
  return brlCompactFormatter.format(value);
}

export function formatCryptoAmount(value: number): string {
  return getCryptoFormatter(value).format(value);
}

export function formatPercent(value: number): string {
  // Value is already in percentage form (e.g., 15.5 for 15.5%)
  return percentFormatter.format(value / 100);
}

export function formatPercentRaw(value: number): string {
  // Value is already in decimal form (e.g., 0.155 for 15.5%)
  return percentFormatter.format(value);
}

export function formatProfitLoss(value: number, percent: number): string {
  const sign = value >= 0 ? '+' : '';
  const emoji = value >= 0 ? '📈' : '📉';
  return `${emoji} ${sign}${formatCurrency(value)} (${formatPercent(percent)})`;
}

export function formatPriceWithChange(price: number, changePercent: number): string {
  const emoji = changePercent >= 0 ? '🟢' : '🔴';
  return `${formatCurrency(price)} ${emoji} ${formatPercent(changePercent)} 24h`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });
}

export function progressBar(percent: number, length: number = 10): string {
  const filled = Math.round((Math.min(percent, 100) / 100) * length);
  const empty = length - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}
