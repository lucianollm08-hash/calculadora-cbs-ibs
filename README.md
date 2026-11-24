# Calculadora CBS/IBS simplificada

Calculadora da Reforma Tributária do Consumo (CBS e IBS, LC 214/2025) para **um item por vez, no regime regular**.
Roda inteira no navegador, publicada no GitHub Pages: **https://paulotroyano.github.io/calculadora-cbs-ibs/**

As regras e tabelas vêm da calculadora oficial da Receita Federal,
[calculadora-rtc-regime-regular](https://github.com/ReceitaFederal/calculadora-rtc-regime-regular) (licença MIT).

## Como funciona

1. `ferramentas/exportar.py` lê o banco oficial (`calculadora-pro.db`) e a API oficial rodando localmente e gera `dados/*.json`:
   classificações tributárias (cClassTrib) com reduções, anexos de NCM/NBS e exceções, tabelas NCM/NBS, UFs/municípios e alíquotas de referência.
2. `calc.js` faz a conta no navegador: `base × alíquota × (1 − redução)`, com a mesma regra de vínculo NCM/NBS × classificação
   da `NcmAplicavelService` oficial, diferimento e situações sem destaque (isenção, imunidade etc.).
3. `ferramentas/validar.js` compara `calc.js` com a API oficial em todas as classificações (datas de 2026 com alíquota de referência
   e 2027 com alíquotas simuladas) e numa amostra de 600 vínculos NCM/NBS. Com `--gravar`, marca como "não calculada"
   cada classificação em que o resultado não bate.

Resultado da última validação: 328 cálculos iguais, 0 diferentes; 600 vínculos iguais, 0 diferentes.

## Comparativo com os impostos atuais (estimativa)

Abaixo do resultado, a página compara a carga de hoje com a CBS/IBS do ano da operação e com a CBS/IBS plena (a partir de 2033).
As alíquotas atuais ficam em `dados/impostos-atuais.json` e podem ser ajustadas na tela:

- **ICMS:** alíquota interna geral de cada UF em 2026, conforme a legislação estadual, compilada em
  [Contmatic](https://simplifique.contmatic.com.br/blogs/tabela-icms-2026) e [Focus NFe](https://focusnfe.com.br/blog/tabela-icms/).
  Não considera benefícios, substituição tributária nem alíquotas específicas por produto.
- **PIS/Cofins:** 9,25% no regime não cumulativo (Leis 10.637/2002 e 10.833/2003) ou 3,65% no cumulativo (Lei 9.718/1998),
  com o ICMS fora da base (STF, Tema 69). Para alimentos do Anexo I (cesta básica), a tela já começa com alíquota zero (Lei 10.925/2004).
- **IPI:** preenchido pelo NCM a partir da [TIPI oficial em PDF](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/legislacao/documentos-e-arquivos/tipi.pdf), baixada e convertida pela rotina diária (`ferramentas/tipi.py` → `dados/tipi.json`). É estimativa: só vale para indústria e importador e não considera os "Ex" da TIPI. Se a leitura falhar, a versão anterior é mantida.
- **ISS:** 5% por padrão, ajustável entre 2% e 5% (LC 116/2003 e LC 157/2016).
- **CBS/IBS plenos:** 26,5% (CBS 8,8% + IBS 17,7%), referência da LC 214/2025, como ponto de partida. No comparativo os dois campos são editáveis, por exemplo para simular 29% com a CBS de 11,3% estimada pelo TCU para 2027. A Resolução CGIBS nº 14/2026 projetou 27,91% para 2027.

O comparativo não considera créditos de etapas anteriores (a apuração com créditos fica na nota com vários itens) nem o Simples Nacional.

## Comparativo no Simples Nacional (estimativa)

Um segundo cartão, também recolhido, compara o DAS de hoje com as duas opções da reforma para o optante pelo Simples:

- **CBS/IBS dentro do DAS**: o total do DAS continua igual; a CBS ocupa o lugar do PIS/Cofins e o IBS o do ICMS/ISS. O cliente só credita o que foi pago de CBS/IBS no DAS.
- **CBS/IBS por fora (regime regular, art. 41, §3º da LC 214/2025)**: o DAS perde as parcelas de PIS/Cofins e ICMS/ISS, e a CBS/IBS é paga com as alíquotas plenas (com as reduções da classificação), descontado o crédito das compras informado. O cliente credita a CBS/IBS cheia.

O DAS usa as tabelas dos Anexos I a V da LC 123/2006 (redação da LC 155/2016) em `dados/simples-nacional.json`: alíquota efetiva pela receita dos últimos 12 meses, repartição por tributo, limite de 5% do ISS com repasse do excedente aos tributos federais e ICMS/ISS fora do DAS acima do sublimite de R$ 3,6 milhões. A calculadora oficial do Simples (ReceitaFederal/calculadora-rtc-simples-nacional) recebe as alíquotas do DAS já prontas, por isso as tabelas da LC 123 são aplicadas aqui.

## Nota com vários itens e créditos

Abaixo do resultado, o botão **Adicionar o item calculado** monta uma nota com vários produtos ou serviços, com os totais de CBS e IBS. A nota fica salva no navegador. Nela dá para informar a CBS e o IBS das notas de compra para ver a apuração do regime regular (débitos − créditos = a recolher, ou saldo credor), de forma simplificada.

## O que ainda não calcula

- Imposto Seletivo, monofasia de combustíveis, alíquotas fixas/setoriais específicas e classificações que exigem dados extras da operação.
  Elas aparecem na lista com "(não calculada)" e o motivo.
- Para datas a partir de 2027 ainda não há alíquota oficial de referência: a página pede as alíquotas para simular.

## Atualização automática

O workflow `.github/workflows/atualizar-tabelas.yml` roda **todo dia**, agendado às 04:43 (Brasília); o GitHub tem atrasado o início em cerca de 8 horas, e também pode ser disparado
manualmente em Actions → "Atualizar tabelas da Receita" → Run workflow. Ele roda `ferramentas/atualizar.sh`, que:

1. baixa a versão mais recente da calculadora oficial da Receita, gera o banco e sobe a API oficial;
2. exporta as tabelas para `dados/` com a data do dia;
3. valida `calc.js` contra a API oficial. Se alguma classificação que funcionava passar a divergir, **não publica**, mantém as tabelas
   antigas e o workflow falha (o GitHub avisa por e-mail);
4. se passar, grava em `dados/meta.json` a data da última verificação e, se alguma tabela mudou, a data da atualização. Essas datas
   aparecem no rodapé da página.

## Atualizar as tabelas manualmente

```bash
git clone --depth 1 https://github.com/ReceitaFederal/calculadora-rtc-regime-regular api && cd api
mkdir -p calculadora/db && ./mvnw flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf
./mvnw clean package -DskipTests && java -Dspring.profiles.active=offline -jar target/api-regime-geral.jar &
cd ..
python3 ferramentas/exportar.py api/calculadora/db/calculadora-pro.db http://localhost:8080 $(date +%F)
node ferramentas/validar.js --gravar && node ferramentas/validar.js
```

## Versão local com a API oficial

A pasta `prototipo-local/` tem a primeira versão, que chama a API oficial rodando no seu computador (Java 21 + Node).
Veja o README dela.

---
Protótipo, não substitui orientação contábil.
