import type { ProbabilityRange } from './types.ts'

const currencyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const percentFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

export function formatCurrency(value: number) {
  return `${currencyFormatter.format(value)} 元`
}

export function formatSignedCurrency(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${formatCurrency(value)}`
}

export function formatPercent(value: number) {
  return percentFormatter.format(value)
}

export function formatPercentRange(range: ProbabilityRange) {
  return `${formatPercent(range.low)} - ${formatPercent(range.high)}`
}

export function formatOdds(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/\.00$/, '')
}
