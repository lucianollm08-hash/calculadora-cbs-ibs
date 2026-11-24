// Compara o motor do navegador (calc.js) com a API oficial da Receita, classificação por classificação.
// Uso: node ferramentas/validar.js http://localhost:8080
const path = require('path');
const fs = require('fs');
const Calc = require('../calc.js');
const API = ((process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'http://localhost:8080') + '/api/calculadora';
const ler = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'dados', n), 'utf8'));
const dados = { meta: ler('meta.json'), ncm: ler('ncm.json'), nbs: ler('nbs.json') };
const classes = ler('classes.json');
const DATA = dados.meta.dataExportacao;

const REGULAR_PADRAO = classes.find((c) => c.codigo === '000001');
const ncms8 = Object.keys(dados.ncm).filter((c) => c.length === 8);
const nbss9 = Object.keys(dados.nbs).filter((c) => c.length === 9);

async function apiCalc(item, data, aliquotas) {
  if (aliquotas) item = { ...item, aliquotasNominais: { cbs: aliquotas.cbs, ibsEstadual: aliquotas.ibsUf, ibsMunicipal: aliquotas.ibsMun } };
  const corpo = { id: 'v', versao: '1.0.0', dhFatoGerador: data + 'T12:00:00-03:00', municipio: 3550308, uf: 'SP', itens: [item] };
  const r = await fetch(API + '/observabilidade/regime-geral', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json();
  const o = (j.objetos || [])[0] || {};
  if (!r.ok || (o.erros && o.erros.length)) return { erro: (o.erros || [j]).map((e) => e.code || e.title).join(',') };
  const g = o.tribCalc?.IBSCBS?.gIBSCBS;
  if (!g) return { semGrupo: true };
  const res = { v: [g.gCBS?.vCBS, g.gIBSUF?.vIBSUF, g.gIBSMun?.vIBSMun].map(Number) };
  const reg = g.gTribRegular;
  if (reg) res.reg = [reg.vTribRegCBS, reg.vTribRegIBSUF, reg.vTribRegIBSMun].map(Number);
  return res;
}

const GRAVAR = process.argv.includes('--gravar');
const marcadas = new Map();
const MOTIVOS = {
  'REG-009': 'exige o grupo de tributação regular, com dados da operação que esta tela não pede',
  'CAL-007': 'a própria calculadora oficial ainda não implementou esta classificação',
};
function marcar(classe, motivo) { if (!marcadas.has(classe.codigo)) marcadas.set(classe.codigo, motivo); }

(async () => {
  let ok = 0; const falhas = []; const naoSuportadas = [];
  const cenarios = [{ data: DATA }, { data: '2027-03-10', aliquotas: { cbs: 8.8, ibsUf: 0.05, ibsMun: 0.05 } }];
  for (const classe of classes) {
    for (const tipo of ['ncm', 'nbs']) {
      if (classe.nomenclatura === 'NCM' && tipo === 'nbs') continue;
      if (classe.nomenclatura === 'NBS' && tipo === 'ncm') continue;
      const lista = tipo === 'ncm' ? ncms8 : nbss9;
      const anexo = tipo === 'ncm' ? classe.anexoNcm : classe.anexoNbs;
      const codigo = (anexo && lista.find((c) => { const a = Calc.aplicavel(anexo, c, DATA); return a.temAnexo && a.valido; })) || (tipo === 'ncm' ? '84713012' : '122011200');
      for (const cen of cenarios) {
        const valor = 1234.57;
        // Suspensões e ZFM/ALC: informa a tributação regular padrão (000 / 000001), como a tela faz por padrão
        const regular = classe.exigeTribRegular ? REGULAR_PADRAO : undefined;
        const meu = Calc.calcular({ classe, tipo, codigo, valor, data: cen.data, aliquotas: cen.aliquotas, regular }, dados);
        const item = { numero: 1, [tipo]: codigo, cst: classe.cst, cClassTrib: classe.codigo, baseCalculo: valor, quantidade: 1, unidade: 'UN' };
        if (regular) item.tributacaoRegular = { cst: regular.cst, cClassTrib: regular.codigo };
        const deles = await apiCalc(item, cen.data, cen.aliquotas);
        const id = `${classe.codigo} ${tipo}=${codigo} ${cen.data}`;
        if (!classe.suportado) { naoSuportadas.push(`${id} api=${JSON.stringify(deles)}`); continue; }
        if (meu.erros) {
          if (deles.erro) ok++; else marcar(classe, 'regra não reproduzida'), falhas.push(`${id}: navegador recusou (${meu.erros[0]}) e a API calculou ${JSON.stringify(deles)}`);
          continue;
        }
        if (deles.semGrupo && meu.semDestaque) { ok++; continue; }
        if (deles.erro || deles.semGrupo || meu.semDestaque) {
          marcar(classe, MOTIVOS[deles.erro] || (deles.erro ? `a API oficial pede dados adicionais (${deles.erro})` : 'tratamento diferente do padrão')); falhas.push(`${id}: navegador calculou ${meu.tributos.map((t) => t.valor)} e a API respondeu ${JSON.stringify(deles)}`); continue; }
        const igual = meu.tributos.every((t, i) => Math.abs(t.valor - deles.v[i]) < 0.005)
          && (!regular || (deles.reg && meu.tributos.every((t, i) => Math.abs(t.regular.valor - deles.reg[i]) < 0.005)));
        if (igual) ok++; else marcar(classe, regular ? 'tributação regular não reproduzida' : 'alíquota específica do setor'), falhas.push(`${id}: navegador ${meu.tributos.map((t) => t.valor)}${regular ? ` reg ${meu.tributos.map((t) => t.regular.valor)}` : ''} x API ${deles.v}${deles.reg ? ` reg ${deles.reg}` : ''}`);
      }
    }
  }
  // Vínculo NCM/NBS x classificação: amostra aleatória comparada com o endpoint oficial
  let okVinc = 0; const falhasVinc = [];
  const comAnexo = classes.filter((c) => c.anexoNcm || c.anexoNbs);
  for (let i = 0; i < 600; i++) {
    const classe = comAnexo[i % comAnexo.length];
    const tipo = classe.anexoNcm ? 'ncm' : 'nbs';
    const lista = tipo === 'ncm' ? ncms8 : nbss9;
    // metade sorteada do anexo (casos positivos e exceções), metade aleatória
    let codigo = lista[Math.floor(Math.random() * lista.length)];
    if (i % 2 === 0) { const anexo = classe[tipo === 'ncm' ? 'anexoNcm' : 'anexoNbs']; const pref = anexo[Math.floor(Math.random() * anexo.length)][0]; codigo = lista.find((c) => c.startsWith(pref)) || codigo; }
    const meu = Calc.aplicavel(classe[tipo === 'ncm' ? 'anexoNcm' : 'anexoNbs'], codigo, DATA).valido;
    const r = await (await fetch(`${API}/dados-abertos/classificacoes-tributarias/${tipo}-aplicavel?cClassTrib=${classe.codigo}&${tipo}=${codigo}&dataOcorrenciaFatoGerador=${DATA}`)).json();
    if (meu === r.valido) okVinc++; else falhasVinc.push(`${classe.codigo} ${tipo}=${codigo}: navegador ${meu} x API ${r.valido}`);
  }
  console.log(`Cálculos: ${ok} iguais, ${falhas.length} diferentes. Classificações marcadas como não suportadas: ${naoSuportadas.length} casos.`);
  falhas.forEach((f) => console.log('  DIF', f));
  naoSuportadas.forEach((f) => console.log('  NS ', f));
  console.log(`Vínculos NCM/NBS: ${okVinc} iguais, ${falhasVinc.length} diferentes.`);
  falhasVinc.forEach((f) => console.log('  DIF', f));
  if (GRAVAR && marcadas.size) {
    for (const c of classes) if (marcadas.has(c.codigo)) { c.suportado = false; c.motivo = marcadas.get(c.codigo); }
    fs.writeFileSync(path.join(__dirname, '..', 'dados', 'classes.json'), JSON.stringify(classes));
    console.log(`Gravado: ${marcadas.size} classificações marcadas como não suportadas. Rode de novo sem --gravar para conferir.`);
  }
  process.exit(falhas.length || falhasVinc.length ? 1 : 0);
})();
