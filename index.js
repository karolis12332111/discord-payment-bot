require('dotenv').config();
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is alive 🚀');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Uptime server running on port ${PORT}`);
});


const {
  Client,
  GatewayIntentBits,
  Events,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} = require('discord.js');

process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

console.log('Starting bot...');
console.log('Token loaded?', !!process.env.DISCORD_TOKEN);
console.log('Token length:', process.env.DISCORD_TOKEN?.length ?? 'MISSING');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN missing in .env');
  process.exit(1);
}
if (!process.env.STAFF_CHANNEL_ID) {
  console.error('❌ STAFF_CHANNEL_ID missing in .env');
  process.exit(1);
}

// ====== In-memory orders ======
const pendingOrders = new Map();
const newOrderId = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const methodToLink = (method) => {
  if (method === 'paypal') return process.env.PAYPAL_LINK;
  if (method === 'stripe') return process.env.STRIPE_LINK;
  if (method === 'crypto') return process.env.CRYPTO_LINK;
  return null;
};

// ====== Client ======
// SVARBU: išėmėm MessageContent intent -> nebereikia įjungti privileged intents portale
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

// Gateway diagnostics
client.on('error', (e) => console.error('CLIENT ERROR:', e));
client.on('shardError', (e) => console.error('SHARD ERROR:', e));
client.on('shardDisconnect', (event, shardId) => {
  console.error('SHARD DISCONNECT:', {
    shardId,
    code: event?.code,
    reason: event?.reason,
    wasClean: event?.wasClean,
  });
  console.error('Hints: 4004=Invalid token | 4014=Privileged intents | 1006/ECONNRESET=Network/Firewall/Antivirus');
});
client.on('shardReconnecting', (id) => console.log('SHARD RECONNECTING:', id));

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== /payment flow ======
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== 'payment') return;

      const menu = new StringSelectMenuBuilder()
        .setCustomId('payment_method_select')
        .setPlaceholder('Select a payment method...')
        .addOptions(
          { label: 'PayPal', value: 'paypal', description: 'Pay via PayPal link' },
          { label: 'Stripe', value: 'stripe', description: 'Pay via Stripe checkout' },
          { label: 'Crypto', value: 'crypto', description: 'Pay via crypto instructions' }
        );

      await interaction.reply({
        content: 'How would you like to pay?',
        components: [new ActionRowBuilder().addComponents(menu)],
        ephemeral: true,
      });
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'payment_method_select') return;

      const method = interaction.values[0];

      const modal = new ModalBuilder()
        .setCustomId(`payment_notes_modal:${method}`)
        .setTitle('Order details');

      const productInput = new TextInputBuilder()
        .setCustomId('product_name')
        .setLabel('What product are you buying?')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: VIP 1 month')
        .setRequired(true);

      const priceInput = new TextInputBuilder()
        .setCustomId('product_price')
        .setLabel('Price (include currency)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Example: 9.99 EUR')
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(productInput),
        new ActionRowBuilder().addComponents(priceInput)
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith('payment_notes_modal:')) return;

      const method = interaction.customId.split(':')[1];
      const product = interaction.fields.getTextInputValue('product_name');
      const price = interaction.fields.getTextInputValue('product_price');
      const orderId = newOrderId();

      const link = methodToLink(method);
      if (!link) {
        await interaction.reply({ content: '❌ Payment link not set for this method.', ephemeral: true });
        return;
      }

      pendingOrders.set(interaction.user.id, {
        method,
        product,
        price,
        orderId,
        createdAt: Date.now(),
      });

      const embed = new EmbedBuilder()
        .setTitle('Payment Request')
        .setDescription('Please complete your payment using the button below.')
        .addFields(
          { name: 'Order ID', value: orderId, inline: true },
          { name: 'Payment method', value: method.toUpperCase(), inline: true },
          { name: 'Product', value: product, inline: false },
          { name: 'Price', value: price, inline: false }
        )
        .setFooter({ text: 'After payment, please send a screenshot in this server.' });

      const payButton = new ButtonBuilder()
        .setLabel('Pay now')
        .setStyle(ButtonStyle.Link)
        .setURL(link);

      await interaction.reply({
        content: '✅ Order created! Complete payment, then send a screenshot.',
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(payButton)],
        ephemeral: true,
      });
      return;
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: '❌ Something went wrong.', ephemeral: true });
      } catch {}
    }
  }
});

// ====== Screenshot handler ======
// Be MessageContent intent, bot'as vis tiek mato attachments, bet NEMATO žinutės teksto.
// Mums pakanka, nes tikrinam attachments.
client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;

    const order = pendingOrders.get(message.author.id);
    if (!order) return;

    const img = message.attachments.find((att) => {
      const name = (att.name || '').toLowerCase();
      return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
    });
    if (!img) return;

    const staffChannel = await message.guild.channels.fetch(process.env.STAFF_CHANNEL_ID).catch(() => null);
    if (!staffChannel) {
      console.error('❌ STAFF channel not found. Check STAFF_CHANNEL_ID.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('New Payment Screenshot')
      .addFields(
        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
        { name: 'Order ID', value: order.orderId, inline: true },
        { name: 'Method', value: order.method.toUpperCase(), inline: true },
        { name: 'Product', value: order.product, inline: false },
        { name: 'Price', value: order.price, inline: false },
        { name: 'Screenshot URL', value: img.url, inline: false }
      )
      .setTimestamp(Date.now());

    await staffChannel.send({ content: '🧾 Payment proof submitted:', embeds: [embed] });

    pendingOrders.delete(message.author.id);
    await message.reply('✅ Screenshot received. Our staff will verify your payment shortly.');
  } catch (err) {
    console.error('MessageCreate error:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);
