export function buildReason(facts, isEn) {
  if (!facts || facts.status === 'STANDBY') {
    return isEn ? 'Bot scanning ' + facts.symbol + '.' : 'Bot memantau ' + facts.symbol + '.';
  }

  const lines = [];
  lines.push('[' + facts.symbol + ' · ' + facts.style + ']');
  
  if (facts.tfSummary) {
    facts.tfSummary.forEach(s => lines.push('• ' + s));
  }

  const tpList = [facts.tp1, facts.tp2, facts.tp3].filter(v => v != null).join(' / ');
  lines.push('• ' + facts.signal + ' @ ' + facts.entry + ' — ' + (facts.orderReason || ''));
  lines.push('• SL: ' + facts.sl + ' (' + facts.riskPips + ' pip) · TP: ' + tpList);
  lines.push('• Conviction: ' + facts.conviction + '/100 ' + facts.convictionLevel);
  lines.push('• Scenario: ' + (facts.scenarioName || ''));

  return lines.join('\n');
}
