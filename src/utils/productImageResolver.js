/**
 * Resolvedor Inteligente de Imagens de Capa para Produtos da Loja Web & Catálogo de Afiliados
 *
 * Mapeia títulos, categorias e nichos para imagens de capa em alta definição (800x800+),
 * garantindo que cada produto tenha uma imagem visualmente fiel, atraente e vendedora.
 */

/**
 * Detecta se uma URL de imagem é genérica, ícone de plataforma (180x180),
 * arte abstrata repetida de placeholder, template não resolvido ou vazia.
 */
function isGenericOrBadImage(url) {
  if (!url || typeof url !== 'string') return true;
  const u = url.trim().toLowerCase();
  if (u === '' || u === 'null' || u === 'undefined') return true;

  // Ícones e logos de plataformas que não representam o produto físico
  if (u.includes('180x180') || u.includes('ios_icon_') || u.includes('android-icon')) return true;
  if (u.includes('mlstatic.com/frontend-assets/ml-web-navigation')) return true;
  if (u.includes('a_generic_10_us_noto_email_v2016_us-main')) return true; // Amazon generic giftcard
  if (u.includes('s.magazineluiza.com.br/banner/magalu-share')) return true;
  if (u.includes('ae01.alicdn.com/kf/s5df9d2bb9cf34ea48fb3c22ec78280f3h')) return true;

  // Templates não resolvidos no banco
  if (u.includes('{sanitized_title}') || u.includes('{title}') || u.includes('%7bsanitized_title%7d') || u.includes('%7btitle%7d')) return true;

  // Placeholders genéricos antigos do Unsplash usados indiscriminadamente no banco
  if (u.includes('photo-1677442136019-21780efad99a')) return true; // Cubo 3D IA abstrato
  if (u.includes('photo-1618005182384-a83a8bd57fbe')) return true; // Fluido roxo abstrato
  if (u.includes('photo-1607082348824-0a96f2a4b9da')) return true; // Sacolas de compras genéricas
  if (u.includes('photo-1550745165-9bc0b252726f')) return true; // Cabos e placa-mãe retrô

  return false;
}

/**
 * Normaliza string removendo acentuação e caracteres especiais para casamento semântico perfeito
 */
function normalizeString(str = '') {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Resolve imagem contextual de produto com base no título, categoria e plataforma.
 * Retorna uma URL em alta definição ou null se nenhum nicho específico casar.
 */
function resolveProductImage(name = '', category = '', platform = '') {
  const n = normalizeString(name);
  const c = normalizeString(category);
  const p = normalizeString(platform);
  const full = `${n} ${c} ${p}`;

  // ==========================================
  // 1. NATAL, FESTAS & DATAS COMEMORATIVAS
  // ==========================================
  if (
    full.includes('festao') || full.includes('enfeite de natal') || full.includes('decoracao festa') ||
    full.includes('natal') || full.includes('arvore de natal') || full.includes('pisca pisca') ||
    full.includes('cortina led') || full.includes('floco de neve') || full.includes('guirlanda') ||
    full.includes('papai noel') || full.includes('rena') || full.includes('ano novo') ||
    full.includes('aniversario') || full.includes('fantasia') || full.includes('balao festa')
  ) {
    return 'https://images.unsplash.com/photo-1512474932049-78ac69ede12c?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 2. MODA FEMININA, ALFAIATARIA & VESTUÁRIO
  // ==========================================
  if (
    full.includes('alfaiataria') || full.includes('colete') || full.includes('calca feminina') ||
    full.includes('conjunto feminino') || full.includes('v neck') || full.includes('vestido') ||
    full.includes('cropped') || full.includes('canelada') || full.includes('saia') ||
    full.includes('blusa') || full.includes('camisa feminina') || full.includes('blazer') ||
    full.includes('macacao') || full.includes('biquini') || full.includes('maio') ||
    full.includes('lingerie') || full.includes('calcinha') || full.includes('sutia') ||
    full.includes('pijama') || full.includes('botoes dourados') || c.includes('moda feminina')
  ) {
    return 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 3. MODA MASCULINA & VESTUÁRIO GERAL
  // ==========================================
  if (
    full.includes('camisa') || full.includes('camiseta') || full.includes('polo') ||
    full.includes('bermuda') || full.includes('calca masculina') || full.includes('jeans') ||
    full.includes('jaqueta') || full.includes('casaco') || full.includes('moletom') ||
    full.includes('terno') || full.includes('cueca') || c.includes('moda masculina') || c.includes('vestuario')
  ) {
    return 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 4. CALÇADOS, TÊNIS & SANDÁLIAS
  // ==========================================
  if (
    full.includes('tenis') || full.includes('sneaker') || full.includes('sapato') ||
    full.includes('sandalia') || full.includes('chinelo') || full.includes('bota') ||
    full.includes('coturno') || full.includes('tamanco') || full.includes('salto alto') ||
    full.includes('sapatilha') || full.includes('rasteirinha') || c.includes('calcados')
  ) {
    return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 5. BOLSAS, MOCHILAS & MALAS
  // ==========================================
  if (
    full.includes('bolsa') || full.includes('mochila') || full.includes('mala de viagem') ||
    full.includes('carteira') || full.includes('pochete') || full.includes('necessaire') ||
    full.includes('maleta') || c.includes('bolsas')
  ) {
    return 'https://images.unsplash.com/photo-1548036328-c9fa89d128fa?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 6. COZINHA, MESA POSTA & DECORAÇÃO GOURMET
  // ==========================================
  if (
    full.includes('saleiro') || full.includes('pimenteiro') || full.includes('chaleira') ||
    full.includes('bule') || full.includes('porcelana') || full.includes('ceramica') ||
    full.includes('marroquino') || full.includes('panela') || full.includes('frigideira') ||
    full.includes('faqueiro') || full.includes('talheres') || full.includes('prato') ||
    full.includes('tigela') || full.includes('bowl') || full.includes('copo') ||
    full.includes('taca') || full.includes('garrafa termica') || full.includes('porta tempero') ||
    full.includes('tabua de corte') || full.includes('pote hermetico') || full.includes('decoracao cozinha')
  ) {
    return 'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 7. ELETRODOMÉSTICOS & LAVANDERIA
  // ==========================================
  if (
    full.includes('maquina de lavar') || full.includes('lavadora') || full.includes('lava e seca') ||
    full.includes('geladeira') || full.includes('refrigerador') || full.includes('freezer') ||
    full.includes('fogao') || full.includes('cooktop') || full.includes('microondas') ||
    full.includes('micro-ondas') || full.includes('lava-loucas') || full.includes('lava loucas') ||
    full.includes('consul') || full.includes('brastemp') || full.includes('electrolux') ||
    c.includes('eletrodomesticos')
  ) {
    return 'https://images.unsplash.com/photo-1626806787461-102c1bfaaea1?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 8. ELETROPORTÁTEIS DE COZINHA
  // ==========================================
  if (
    full.includes('air fryer') || full.includes('airfryer') || full.includes('fritadeira') ||
    full.includes('liquidificador') || full.includes('batedeira') || full.includes('cafeteira') ||
    full.includes('mixer') || full.includes('sanduicheira') || full.includes('grill') ||
    full.includes('torradeira') || full.includes('panela eletrica')
  ) {
    return 'https://images.unsplash.com/photo-1585515320310-259814833e62?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 9. BEBÊS, CRIANÇAS & BRINQUEDOS
  // ==========================================
  if (
    full.includes('chocalho') || full.includes('argola de madeira') || full.includes('mordedor') ||
    full.includes('chupeta') || full.includes('mamadeira') || full.includes('fralda') ||
    full.includes('babador') || full.includes('carrinho de bebe') || full.includes('berco') ||
    full.includes('brinquedo') || full.includes('boneca') || full.includes('pelucia') ||
    full.includes('lego') || full.includes('jogos infantis') || full.includes('slime') ||
    c.includes('bebes') || c.includes('brinquedos') || c.includes('maternidade')
  ) {
    return 'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 10. LIVROS, KINDLE & LEITORES DIGITAIS
  // ==========================================
  if (
    full.includes('kindle') || full.includes('paperwhite') || full.includes('e-reader') ||
    full.includes('ereader') || full.includes('livro') || full.includes('livros') ||
    full.includes('box livros') || full.includes('leitura') || full.includes('biografia') ||
    full.includes('romance') || c.includes('livros') || c.includes('ebooks')
  ) {
    return 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 11. ESCRITÓRIO, ERGONOMIA & HOME OFFICE
  // ==========================================
  if (
    full.includes('cadeira ergonomica') || full.includes('cadeira de escritorio') ||
    full.includes('cadeira presidente') || full.includes('cadeira gamer') ||
    full.includes('mesa gamer') || full.includes('mesa escritorio') ||
    full.includes('suporte monitor') || full.includes('suporte articulado') ||
    full.includes('apoio pes') || c.includes('escritorio')
  ) {
    return 'https://images.unsplash.com/photo-1580481077195-c3a821a58875?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 12. LIMPEZA & ORGANIZAÇÃO DA CASA
  // ==========================================
  if (
    full.includes('mop') || full.includes('mop giratorio') || full.includes('rodo magico') ||
    full.includes('aspirador') || full.includes('robo aspirador') || full.includes('balde') ||
    full.includes('vassoura') || full.includes('espanador') || full.includes('organizador') ||
    full.includes('caixa organizadora') || full.includes('cabide') || full.includes('cesto de roupa') ||
    full.includes('varal') || c.includes('limpeza')
  ) {
    return 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 13. DECORAÇÃO, ILUMINAÇÃO & CASA
  // ==========================================
  if (
    full.includes('cortina') || full.includes('almofada') || full.includes('tapete') ||
    full.includes('espelho') || full.includes('quadro') || full.includes('vaso') ||
    full.includes('luminaria') || full.includes('abajur') || full.includes('lencol') ||
    full.includes('edredom') || full.includes('toalha de banho') || full.includes('difusor de aromas') ||
    c.includes('decoracao') || c.includes('cama mesa e banho')
  ) {
    return 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 14. BELEZA, SKINCARE, PERFUMARIA & MAQUIAGEM
  // ==========================================
  if (
    full.includes('perfume') || full.includes('colonia') || full.includes('maquiagem') ||
    full.includes('batom') || full.includes('base facial') || full.includes('rimel') ||
    full.includes('serum') || full.includes('skincare') || full.includes('hidratante') ||
    full.includes('protetor solar') || full.includes('shampoo') || full.includes('condicionador') ||
    full.includes('mascara capilar') || full.includes('escova secadora') || full.includes('secador') ||
    full.includes('chapinha') || full.includes('babyliss') || full.includes('barbeador') ||
    full.includes('maquina de cortar cabelo') || full.includes('sabonete') || c.includes('beleza')
  ) {
    return 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 15. PET SHOP
  // ==========================================
  if (
    full.includes('racao') || full.includes('petisco') || full.includes('coleira') ||
    full.includes('peitoral') || full.includes('guia cachorro') || full.includes('cama pet') ||
    full.includes('arranhador') || full.includes('caixa de areia') || full.includes('brinquedo pet') ||
    full.includes('bebedouro pet') || full.includes('comedouro') || full.includes('tapete higienico') ||
    c.includes('pet') || c.includes('petshop')
  ) {
    return 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 16. FERRAMENTAS & CONSTRUÇÃO
  // ==========================================
  if (
    full.includes('furadeira') || full.includes('parafusadeira') || full.includes('jogo de ferramentas') ||
    full.includes('maleta de ferramentas') || full.includes('chave de fenda') || full.includes('martelo') ||
    full.includes('alicate') || full.includes('trena') || full.includes('nivel laser') ||
    full.includes('serra') || full.includes('lixadeira') || full.includes('mangueira') ||
    c.includes('ferramentas')
  ) {
    return 'https://images.unsplash.com/photo-1581783342308-f792dbdd27c5?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 17. ESPORTES, FITNESS & SUPLEMENTOS
  // ==========================================
  if (
    full.includes('beach tennis') || full.includes('raquete') || full.includes('whey') ||
    full.includes('creatina') || full.includes('bcaa') || full.includes('halteres') ||
    full.includes('kettlebell') || full.includes('corda de pular') || full.includes('colchonete') ||
    full.includes('tapete yoga') || full.includes('squeeze') || full.includes('bicicleta') ||
    full.includes('academia') || full.includes('suplemento') || c.includes('esporte') || c.includes('fitness')
  ) {
    return 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 18. SMARTPHONES & CELULARES
  // ==========================================
  if (
    full.includes('smartphone') || full.includes('celular') || full.includes('iphone') ||
    full.includes('samsung galaxy') || full.includes('xiaomi') || full.includes('motorola') ||
    full.includes('redmi') || full.includes('poco') || c.includes('celulares') || c.includes('smartphones')
  ) {
    return 'https://images.unsplash.com/photo-1511707171634-5f897ff02560?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 19. FONES DE OUVIDO, SOM & HEADSETS
  // ==========================================
  if (
    full.includes('fone') || full.includes('headset') || full.includes('auricular') ||
    full.includes('tws') || full.includes('airpod') || full.includes('headphone') ||
    full.includes('caixa de som') || full.includes('jbl') || full.includes('alexa') ||
    full.includes('echo dot') || full.includes('smart speaker') || c.includes('audio')
  ) {
    return 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 20. INFORMÁTICA, TECLADOS & MOUSES
  // ==========================================
  if (
    full.includes('teclado') || full.includes('keyboard') || full.includes('rgb gamer') ||
    full.includes('mouse') || full.includes('mousepad') || full.includes('notebook') ||
    full.includes('laptop') || full.includes('macbook') || full.includes('monitor') ||
    full.includes('computador gamer') || c.includes('informatica')
  ) {
    return 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 21. SMARTWATCHES & ACESSÓRIOS TECH
  // ==========================================
  if (
    full.includes('smartwatch') || full.includes('smart watch') || full.includes('relogio inteligente') ||
    full.includes('pulseira inteligente') || full.includes('relogio') || full.includes('carregador') ||
    full.includes('cabo usb') || full.includes('powerbank') || full.includes('suporte celular')
  ) {
    return 'https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 22. DRONES & FOTOGRAFIA
  // ==========================================
  if (full.includes('drone') || full.includes('camera') || full.includes('fotografia') || full.includes('tripé') || full.includes('ring light')) {
    return 'https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 23. AUTOPEÇAS & AUTOMOTIVO
  // ==========================================
  if (
    full.includes('oleo') || full.includes('5w30') || full.includes('filtro') ||
    full.includes('pneu') || full.includes('pastilha') || full.includes('disco de freio') ||
    full.includes('amortecedor') || full.includes('peca automotiva') || full.includes('bateria carro') ||
    full.includes('lubrificante') || full.includes('motor') || c.includes('automotivo') || c.includes('auto pecas')
  ) {
    return 'https://images.unsplash.com/photo-1486006920555-c77dce18193b?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 24. GASTRONOMIA, RESTAURANTES & DELIVERY
  // ==========================================
  if (full.includes('temaki')) {
    return 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('hot roll') || full.includes('uramaki') || full.includes('hossomaki')) {
    return 'https://images.unsplash.com/photo-1553621042-f6e147245754?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('yakisoba') || full.includes('noodle') || full.includes('chapa oriental')) {
    return 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('sashimi') || full.includes('salmao') || full.includes('combinado') || full.includes('sushi') || c.includes('oriental') || c.includes('salmao')) {
    return 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('pizza') || full.includes('calzone') || c.includes('pizza')) {
    return 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('hamburguer') || full.includes('burger') || full.includes('artesanal') || full.includes('bacon')) {
    return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('cafe') || full.includes('cappuccino') || full.includes('espresso')) {
    return 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 25. FINANÇAS, CRIPTO & TRADING
  // ==========================================
  if (full.includes('cripto') || full.includes('bitcoin') || full.includes('trader') || full.includes('sinais') || full.includes('scalper') || full.includes('defi') || c.includes('cripto') || c.includes('financas')) {
    return 'https://images.unsplash.com/photo-1642543492481-44e81e3914a7?w=800&auto=format&fit=crop&q=80';
  }

  // ==========================================
  // 26. AUTOMAÇÃO, SOFTWARE & BOTS (LOJA OFICIAL PAYBOT)
  // ==========================================
  if (full.includes('spybot') || full.includes('whatsapp') || full.includes('atendimento inteligente') || full.includes('conversational') || c.includes('whatsapp')) {
    return 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('aluguel') || full.includes('licenca vitalicia') || full.includes('paybot') || c.includes('aluguel')) {
    return 'https://images.unsplash.com/photo-1556742049-0a67c5574f73?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('saas') || full.includes('tenant') || full.includes('gestao comercial') || full.includes('crm') || full.includes('painel master')) {
    return 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('servidor') || full.includes('vps') || full.includes('hardware') || c.includes('hardware')) {
    return 'https://images.unsplash.com/photo-1558494949-ef010cbdcc31?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('workstation') || full.includes('rig')) {
    return 'https://images.unsplash.com/photo-1587202372775-e229f172b9d7?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('rag') || full.includes('busca semantica') || full.includes('base de conhecimento') || full.includes('ia sniper') || c.includes('inteligencia artificial') || c === 'ia') {
    return 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('seo') || full.includes('posicionamento organico') || full.includes('google 1a') || c.includes('seo')) {
    return 'https://images.unsplash.com/photo-1571721795195-a2ca2d3370a9?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('pagespeed') || full.includes('core web vitals') || full.includes('otimizacao') || c.includes('otimizacoes')) {
    return 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('landing page') || full.includes('alta conversao')) {
    return 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('site') || full.includes('portal corporativo') || c.includes('sites') || c.includes('projetos')) {
    return 'https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('full-stack') || full.includes('desenvolvimento de software') || c.includes('softwares')) {
    return 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('api') || full.includes('webhook') || full.includes('gateway')) {
    return 'https://images.unsplash.com/photo-1555421689-491a97ff2040?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('banco de dados') || full.includes('backend') || full.includes('latencia')) {
    return 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('meteorico') || full.includes('manada') || full.includes('sub-bot') || c.includes('meteorico')) {
    return 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('app') || full.includes('aplicativo') || full.includes('pwa') || full.includes('mobile') || c.includes('aplicativos')) {
    return 'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('mentoria') || full.includes('consultoria') || full.includes('1on1') || c.includes('mentorias')) {
    return 'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('curso') || full.includes('ebook') || full.includes('pdf') || full.includes('treinamento')) {
    return 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&auto=format&fit=crop&q=80';
  }
  if (full.includes('papelaria') || full.includes('postit') || full.includes('caneta') || full.includes('grampeador') || full.includes('fita') || c.includes('papelaria')) {
    return 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=800&auto=format&fit=crop&q=80';
  }

  // 🛡️ NUNCA retornar uma imagem arbitrária de cabos retrô ou genéricos desconexos
  // Retorna null para permitir que o chamador use a imagem real do site de origem (OpenGraph / JSON-LD)
  return null;
}

/**
 * Retorna imagem do produto garantindo um fallback limpo e elegante de vitrine comercial caso nenhum nicho case
 */
function resolveProductImageWithFallback(name = '', category = '', platform = '') {
  const resolved = resolveProductImage(name, category, platform);
  if (resolved && !isGenericOrBadImage(resolved)) {
    return resolved;
  }
  // Vitrine elegante e neutra de produtos comerciais de alta conversão
  return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=800&auto=format&fit=crop&q=80';
}

module.exports = {
  resolveProductImage,
  resolveProductImageWithFallback,
  isGenericOrBadImage
};
