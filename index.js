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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
} = require('discord.js');

process.on('unhandledRejection', (e) => console.error('UNHANDLED REJECTION:', e));
process.on('uncaughtException', (e) => console.error('UNCAUGHT EXCEPTION:', e));

console.log('Starting bot...');
console.log('Token loaded?', !!process.env.DISCORD_TOKEN);
console.log('Token length:', process.env.DISCORD_TOKEN?.length ?? 'MISSING');

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ DISCORD_TOKEN missing in env');
  process.exit(1);
}
if (!process.env.STAFF_CHANNEL_ID) {
  console.error('❌ STAFF_CHANNEL_ID missing in env');
  process.exit(1);
}
if (!process.env.PAYPAL_RECEIVER) {
  console.error('❌ PAYPAL_RECEIVER missing in env (email or paypal.me username)');
  process.exit(1);
}

// ====== In-memory orders ======
const pendingOrders = new Map();
const newOrderId = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// ====== Client ======
// No privileged intents needed
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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

// ====== /payment flow (PayPal only) ======
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // /payment -> show modal immediately
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== 'payment') return;

      const modal = new ModalBuilder()
        .setCustomId('paypal_payment_modal')
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

    // Modal submit
    if (interaction.isModalSubmit()) {
      if (interaction.customId !== 'paypal_payment_modal') return;

      const product = interaction.fields.getTextInputValue('product_name');
      const price = interaction.fields.getTextInputValue('product_price');
      const orderId = newOrderId();

      pendingOrders.set(interaction.user.id, {
        method: 'paypal',
        product,
        price,
        orderId,
        createdAt: Date.now(),
      });

      const receiver = process.env.PAYPAL_RECEIVER;

      const embed = new EmbedBuilder()
        .setTitle('PayPal Payment Instructions')
        .setDescription(
          [
            'Please complete the payment in PayPal using the instructions below.',
            '',
            `**Send to this PayPal:** **${receiver}**`,
            '',
            '**Important:** In the PayPal note/message, paste this exactly:',
            `\`${orderId} | ${product} | ${price}\``,
            '',
            'After payment, **please send a screenshot** in this server.'
          ].join('\n')
        )
        .addFields(
          { name: 'Order ID', value: orderId, inline: true },
          { name: 'Product', value: product, inline: false },
          { name: 'Price', value: price, inline: false }
        )
        .setFooter({ text: 'We verify payments manually.' });

      await interaction.reply({
        content: '✅ Order created! Follow the PayPal instructions below.',
        embeds: [embed],
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
      .setTitle('New PayPal Payment Screenshot')
      .addFields(
        { name: 'User', value: `${message.author.tag} (${message.author.id})`, inline: false },
        { name: 'Order ID', value: order.orderId, inline: true },
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
