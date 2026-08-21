const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const Usuario = require('../models/Usuario');
const { PLANES, planPorPriceId } = require('../helpers/stripePlanes');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const authMiddleware = require('../middleware/authMiddleware');

router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { plan } = req.body;

    const config = PLANES[plan];
    if (!config || !config.priceId) {
      return res.status(400).json({ ok: false, error: 'Plan no válido' });
    }

   console.log('Checkout - email del token:', req.user.email);
    const usuario = await Usuario.findOne({ email: req.user.email });
    if (!usuario) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    let customerId = usuario.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: usuario.email,
        metadata: { usuarioId: String(usuario._id) }
      });
      customerId = customer.id;
      usuario.stripeCustomerId = customerId;
      await usuario.save();
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: config.priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/monitor?pago=exitoso`,
      cancel_url: `${process.env.FRONTEND_URL}/planes?pago=cancelado`,
      locale: 'es',
      metadata: { usuarioId: String(usuario._id), plan }
    });

    res.json({ ok: true, url: session.url });
  } catch (error) {
    console.error('Error creando checkout:', error);
    res.status(500).json({ ok: false, error: 'No se pudo iniciar el pago' });
  }
});

router.post('/webhook', async (req, res) => {
  let evento;

  try {
    evento = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error('Firma de webhook inválida:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    switch (evento.type) {
      case 'checkout.session.completed': {
        const session = evento.data.object;
        const usuarioId = session.metadata?.usuarioId;
        const plan = session.metadata?.plan;
        const config = PLANES[plan];

        if (usuarioId && config) {
          await Usuario.findByIdAndUpdate(usuarioId, {
            $set: {
              plan,
              limiteImpresoras: config.limiteImpresoras,
              activo: true,
              stripeSubscriptionId: session.subscription
            }
          });
          console.log(`Plan activado: ${usuarioId} → ${plan}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = evento.data.object;
        const priceId = sub.items?.data?.[0]?.price?.id;
        const plan = planPorPriceId(priceId);
        const config = PLANES[plan];
        const activa = ['active', 'trialing'].includes(sub.status);

        if (config) {
          await Usuario.findOneAndUpdate(
            { stripeCustomerId: sub.customer },
            {
              $set: {
                plan,
                limiteImpresoras: config.limiteImpresoras,
                activo: activa,
                stripeSubscriptionId: sub.id
              }
            }
          );
          console.log(`Suscripción actualizada: ${sub.customer} → ${plan} (${sub.status})`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = evento.data.object;
        await Usuario.findOneAndUpdate(
          { stripeCustomerId: sub.customer },
          { $set: { activo: false }, $unset: { stripeSubscriptionId: '' } }
        );
        console.log(`Suscripción cancelada: ${sub.customer}`);
        break;
      }

      case 'invoice.payment_failed': {
        const factura = evento.data.object;
        console.warn(`Pago fallido: ${factura.customer}`);
        break;
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error procesando webhook:', error);
    res.status(500).json({ error: 'Error procesando evento' });
  }
});

module.exports = router;