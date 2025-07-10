import { Client, GatewayIntentBits, Collection, Partials, REST, Routes } from 'discord.js';
import fs from 'fs'; // ✅ only this ONCE
import path from 'path';
import { fileURLToPath } from 'url';
import { handleGiveawayEnd } from './utils.js';

// ✅ JSON config loaded without import assertion
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

client.commands = new Collection();

// Load commands
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
const commands = [];

for (const file of commandFiles) {
  const command = await import(`./commands/${file}`);
  client.commands.set(command.default.data.name, command.default);
  commands.push(command.default.data.toJSON());
}

// Register slash commands
const rest = new REST({ version: '10' }).setToken(config.token);

try {
  console.log('Refreshing commands...');
  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
  console.log('Commands loaded.');
} catch (err) {
  console.error(err);
}

// Handle interaction
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (command) await command.execute(interaction, client);
  } else if (interaction.isButton()) {
    const [action, giveawayId] = interaction.customId.split('_');
    const giveaways = JSON.parse(fs.readFileSync('./giveaways.json'));
    const giveaway = giveaways.find(g => g.id === giveawayId);

    if (!giveaway) {
      return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
    }

    if (action === 'join') {
      if (!giveaway.entries.includes(interaction.user.id)) {
        giveaway.entries.push(interaction.user.id);
        fs.writeFileSync('./giveaways.json', JSON.stringify(giveaways, null, 2));
        await interaction.reply({ content: '🎉 You have joined the giveaway!', ephemeral: true });
      } else {
        await interaction.reply({ content: 'You are already in the giveaway!', ephemeral: true });
      }
    }

    if (action === 'leave') {
      if (giveaway.entries.includes(interaction.user.id)) {
        giveaway.entries = giveaway.entries.filter(id => id !== interaction.user.id);
        fs.writeFileSync('./giveaways.json', JSON.stringify(giveaways, null, 2));
        await interaction.reply({ content: '❌ You left the giveaway.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'You are not part of the giveaway.', ephemeral: true });
      }
    }a
    a
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  
  // Load giveaways
  if (!fs.existsSync('./giveaways.json')) return;
  const giveaways = JSON.parse(fs.readFileSync('./giveaways.json'));

  // Filter active activity giveaways in this channel
  const now = Date.now();
  const activityGiveaways = giveaways.filter(g => g.channelId === message.channel.id && g.type === 'activity' && g.endTimestamp > now);

  for (const giveaway of activityGiveaways) {
    giveaway.entries[message.author.id] = (giveaway.entries[message.author.id] ?? 0) + 1;
  }

  // Save updated giveaways
  fs.writeFileSync('./giveaways.json', JSON.stringify(giveaways, null, 2));
});

// Auto-end giveaways
setInterval(() => handleGiveawayEnd(client), 10_000);

client.login(config.token);
