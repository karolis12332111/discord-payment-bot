require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const command = new SlashCommandBuilder()
  .setName('payment')
  .setDescription('Start a payment flow');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.CLIENT_ID || !process.env.GUILD_ID) {
      console.error('Missing CLIENT_ID or GUILD_ID in .env');
      process.exit(1);
    }

    console.log('Registering /payment...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [command.toJSON()] }
    );
    console.log('✅ Done. You should now see /payment in your server.');
  } catch (err) {
    console.error('❌ Failed to register command:', err);
  }
})();
