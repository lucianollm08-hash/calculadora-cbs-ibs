"""Exporta as tabelas oficiais da calculadora da Receita para JSON (usado pela página estática).

Uso: python3 ferramentas/exportar.py <caminho do calculadora-pro.db> <url da API rodando> <data AAAA-MM-DD>
A API oficial (perfil offline) precisa estar rodando para os dados de classificação.
"""
import json, sqlite3, sys, urllib.request, urllib.error, re, os

DB, API, DATA = sys.argv[1], sys.argv[2].rstrip('/'), sys.argv[3]
SAIDA = os.path.join(os.path.dirname(__file__), '..', 'dados')
c = sqlite3.connect(DB)
vig = lambda ini, fim: f"({ini} <= '{DATA}' and ({fim} is null or {fim} >= '{DATA}'))"

def api(caminho):
    with urllib.request.urlopen(API + '/api/calculadora' + caminho) as r:
        return json.load(r)

def salvar(nome, obj):
    with open(os.path.join(SAIDA, nome), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))

# ---- anexos (NCM/NBS aplicáveis) com exceções, regra igual à NcmAplicavelService ----
def anexos(tab, pre, exc, epre, fk):
    out = {}
    for cltr, rid, cod, ini, fim in c.execute(f'select {pre}_CLTR_ID,{pre}_ID,{pre}_{tab}_CD,{pre}_INICIO_VIGENCIA,{pre}_FIM_VIGENCIA from {tab}_APLICAVEL'):
        excs = [list(r) for r in c.execute(f'select {epre}_{tab}_CD,{epre}_INICIO_VIGENCIA,{epre}_FIM_VIGENCIA from {exc} where {epre}_{fk}=?', (rid,))]
        out.setdefault(cltr, []).append([cod, ini, fim, excs])
    return out
anx_ncm = anexos('NCM', 'NCMA', 'EXCECAO_NCM_APLICAVEL', 'ENCM', 'NCMA_ID')
anx_nbs = anexos('NBS', 'NBSA', 'EXCECAO_NBS_APLICAVEL', 'ENBS', 'NBSA_ID')

# ---- classificações ----
trat = {}
for cltr, desc, aliq, base, mono, exige, incomp in c.execute(f'''
    select tc.TRCL_CLTR_ID, t.TRTR_DESCRICAO, t.TRTR_EXPRESSAO_ALIQUOTA, t.TRTR_EXPRESSAO_BASE_CALCULO, t.TRTR_IN_POSSUI_MONOFASIA,
           t.TRTR_IN_EXIGE_GRUPO_DESONERACAO, t.TRTR_IN_INCOMPATIVEL_COM_SUSPENSAO
    from TRATAMENTO_CLASSIFICACAO tc join TRATAMENTO_TRIBUTARIO t on t.TRTR_ID = tc.TRCL_TRTR_ID
    where {vig('tc.TRCL_INICIO_VIGENCIA','tc.TRCL_FIM_VIGENCIA')}'''):
    fator = 1.0
    if base == 'baseCalculoInformada*0.5': fator = 0.5
    elif base and '(1-100/100)' in base: fator = 0.0
    elif base != 'baseCalculoInformada-impostoSeletivoInformado+impostoSeletivoCalculado': fator = None
    trat[cltr] = {'tratamento': desc, 'aliquotaZero': aliq == '0', 'fatorBase': fator,
                  # grupo de tributação regular (suspensões e ZFM/ALC): calc.js usa a classificação regular informada
                  'exigeTribRegular': bool(exige), 'incompativelSuspensao': bool(incomp),
                  'suportado': bool(fator is not None and not mono and aliq in ('aliquota', '0'))}

flags = {cd: (g, d) for cd, g, d in c.execute(f"select SITR_CD, SITR_IND_GIBSCBS, SITR_IND_GDIF from SITUACAO_TRIBUTARIA where SITR_ID <= 18 and {vig('SITR_INICIO_VIGENCIA','SITR_FIM_VIGENCIA')}")}
ids = {cod: i for i, cod in c.execute(f"select CLTR_ID, CLTR_CD from CLASSIFICACAO_TRIBUTARIA where {vig('CLTR_INICIO_VIGENCIA','CLTR_FIM_VIGENCIA')}")}
classes = []
for st in api(f'/dados-abertos/situacoes-tributarias/cbs-ibs?data={DATA}'):
    for cl in st['classificacoesTributarias']:
        i = ids.get(cl['codigo'])
        try:
            d = api(f"/dados-abertos/classificacoes-tributarias/cbs-ibs/class-trib/{cl['codigo']}?data={DATA}")
        except urllib.error.HTTPError:  # listada, mas fora de vigência na data
            continue
        t = trat.get(i, {'tratamento': d.get('descricaoTratamentoTributario'), 'aliquotaZero': False, 'fatorBase': None, 'suportado': False, 'exigeTribRegular': False, 'incompativelSuspensao': False})
        classes.append({
            'codigo': cl['codigo'], 'descricao': cl['descricao'], 'cst': st['codigo'], 'cstDescricao': st['descricao'],
            'tipoAliquota': d.get('tipoAliquota'), 'nomenclatura': d.get('nomenclatura'),
            'tratamento': d.get('descricaoTratamentoTributario') or t['tratamento'],
            'reducao': [d.get('percentualReducaoCbs') or 0, d.get('percentualReducaoIbsUf') or 0, d.get('percentualReducaoIbsMun') or 0],
            'destacaCbsIbs': bool(flags.get(st['codigo'], (1, 0))[0]), 'diferimento': bool(flags.get(st['codigo'], (1, 0))[1]),
            'aliquotaZero': t['aliquotaZero'], 'fatorBase': t['fatorBase'],
            'exigeTribRegular': t['exigeTribRegular'], 'incompativelSuspensao': t['incompativelSuspensao'], 'suportado': t['suportado'],
            'anexoNcm': anx_ncm.get(i), 'anexoNbs': anx_nbs.get(i),
        })
salvar('classes.json', classes)

# ---- NCM / NBS (todos os níveis, para montar a hierarquia de descrição) ----
limpa = lambda s: re.sub(r'<[^>]+>', '', s or '').strip()
salvar('ncm.json', {cd: limpa(ds) for cd, ds in c.execute(f"select NCM_CD,NCM_DESCRICAO from NCM where {vig('NCM_INICIO_VIGENCIA','NCM_FIM_VIGENCIA')}")})
salvar('nbs.json', {cd: limpa(ds) for cd, ds in c.execute(f"select NBS_CD,NBS_DESCRICAO from NBS where {vig('NBS_INICIO_VIGENCIA','NBS_FIM_VIGENCIA')}")})

# ---- UFs e municípios ----
ufs = {}
for cod, nome, sigla in c.execute('select * from UF order by UF_SIGLA'):
    ufs[sigla] = {'codigo': cod, 'nome': nome, 'municipios': [[m, n] for m, n in c.execute('select MUNI_CD, MUNI_NOME from MUNICIPIO where MUNI_UF_CD=? order by MUNI_NOME', (cod,))]}
salvar('ufs.json', ufs)

# ---- alíquotas de referência e versão ----
ref = [{'tributo': s, 'valor': v, 'inicio': i, 'fim': f} for v, i, f, s in c.execute(
    'select a.ALRE_VALOR,a.ALRE_INICIO_VIGENCIA,a.ALRE_FIM_VIGENCIA,t.TBTO_SIGLA from ALIQUOTA_REFERENCIA a join TRIBUTO t on t.TBTO_ID=a.ALRE_TBTO_ID')]
versao = c.execute('select VRBD_VERSAO_BASE_DADO, VRBD_DATA, VRBD_DESCRICAO from VERSAO_BASE_DADO order by VRBD_ID desc limit 1').fetchone()
salvar('meta.json', {'dataExportacao': DATA, 'versaoBase': versao[0], 'dataVersaoBase': versao[1][:10], 'aliquotasReferencia': ref})
print(len(classes), 'classes;', sum(x['suportado'] for x in classes), 'suportadas pela fórmula simples')
