const PLANES = {
  starter: {
    priceId: process.env.STRIPE_PRICE_STARTER,
    limiteImpresoras: 100,
    nombre: 'Starter'
  },
  pro: {
    priceId: process.env.STRIPE_PRICE_PRO,
    limiteImpresoras: 250,
    nombre: 'Pro'
  },
  enterprise: {
    priceId: process.env.STRIPE_PRICE_ENTERPRISE,
    limiteImpresoras: 600,
    nombre: 'Enterprise'
  }
};

function planPorPriceId(priceId) {
  const entrada = Object.entries(PLANES).find(([, v]) => v.priceId === priceId);
  return entrada ? entrada[0] : null;
}

module.exports = { PLANES, planPorPriceId };