const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Data storage files
const GIVEAWAYS_FILE = path.join(__dirname, 'giveaways.json');
const ACTIVITY_FILE = path.join(__dirname, 'activity.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Admin role ID
const ADMIN_ROLE_ID = '1380843084522197103';

// Default configuration
const DEFAULT_CONFIG = {
    activityMultiplier: 1.5,
    maxActivityBonus: 5.0,
    messagePointValue: 1,
    reactionPointValue: 0.5,
    voiceMinuteValue: 2,
    activityDecayDays: 30,
    adminRoles: [ADMIN_ROLE_ID]
};

// Load or create data files
function loadData(filename, defaultData = {}) {
    try {
        if (fs.existsSync(filename)) {
            return JSON.parse(fs.readFileSync(filename, 'utf8'));
        }
    } catch (error) {
        console.error(`Error loading ${filename}:`, error);
    }
    return defaultData;
}

function saveData(filename, data) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error saving ${filename}:`, error);
    }
}

// Check if user has admin permissions
function hasAdminPermissions(member) {
    return member.permissions.has(PermissionFlagsBits.Administrator) || 
           member.roles.cache.has(ADMIN_ROLE_ID);
}

// Initialize data
let giveaways = loadData(GIVEAWAYS_FILE, {});
let activity = loadData(ACTIVITY_FILE, {});
let config = loadData(CONFIG_FILE, DEFAULT_CONFIG);

// Activity tracking
function updateActivity(userId, guildId, type, amount = 1) {
    const key = `${guildId}_${userId}`;
    if (!activity[key]) {
        activity[key] = {
            messages: 0,
            reactions: 0,
            voiceMinutes: 0,
            lastUpdate: Date.now()
        };
    }
    
    activity[key][type] += amount;
    activity[key].lastUpdate = Date.now();
    saveData(ACTIVITY_FILE, activity);
}

function getActivityScore(userId, guildId) {
    const key = `${guildId}_${userId}`;
    const userActivity = activity[key];
    
    if (!userActivity) return 1;
    
    const now = Date.now();
    const daysSinceUpdate = (now - userActivity.lastUpdate) / (1000 * 60 * 60 * 24);
    
    // Apply decay if user hasn't been active recently
    const decayFactor = Math.max(0.1, 1 - (daysSinceUpdate / config.activityDecayDays));
    
    const score = (
        userActivity.messages * config.messagePointValue +
        userActivity.reactions * config.reactionPointValue +
        userActivity.voiceMinutes * config.voiceMinuteValue
    ) * decayFactor;
    
    return Math.min(config.maxActivityBonus, Math.max(1, 1 + (score * config.activityMultiplier / 100)));
}

// Giveaway management
function createGiveaway(guildId, channelId, data) {
    const id = Date.now().toString();
    giveaways[id] = {
        id,
        guildId,
        channelId,
        ...data,
        entries: [],
        createdAt: Date.now(),
        active: true
    };
    saveData(GIVEAWAYS_FILE, giveaways);
    return id;
}

function endGiveaway(id) {
    if (giveaways[id]) {
        giveaways[id].active = false;
        giveaways[id].endedAt = Date.now();
        saveData(GIVEAWAYS_FILE, giveaways);
    }
}

function selectWinners(giveawayId, count) {
    const giveaway = giveaways[giveawayId];
    if (!giveaway || !giveaway.entries.length) return [];
    
    const weightedEntries = [];
    
    // Create weighted entries based on activity
    giveaway.entries.forEach(userId => {
        const weight = getActivityScore(userId, giveaway.guildId);
        const entries = Math.ceil(weight * 10); // Convert to integer weight
        
        for (let i = 0; i < entries; i++) {
            weightedEntries.push(userId);
        }
    });
    
    const winners = [];
    const usedEntries = new Set();
    
    while (winners.length < count && weightedEntries.length > 0) {
        const randomIndex = Math.floor(Math.random() * weightedEntries.length);
        const winner = weightedEntries[randomIndex];
        
        if (!usedEntries.has(winner)) {
            winners.push(winner);
            usedEntries.add(winner);
        }
        
        // Remove all entries for this user to prevent duplicate wins
        for (let i = weightedEntries.length - 1; i >= 0; i--) {
            if (weightedEntries[i] === winner) {
                weightedEntries.splice(i, 1);
            }
        }
    }
    
    return winners;
}

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Create a new giveaway')
        .addStringOption(option =>
            option.setName('prize')
                .setDescription('The prize for the giveaway')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('Duration in minutes')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('winners')
                .setDescription('Number of winners')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to host the giveaway')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('requirements')
                .setDescription('Entry requirements')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Additional description')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('activity_bonus')
                .setDescription('Enable activity-based bonus (default: true)')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('gend')
        .setDescription('End a giveaway early')
        .addStringOption(option =>
            option.setName('giveaway_id')
                .setDescription('The ID of the giveaway to end')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('greroll')
        .setDescription('Reroll a giveaway')
        .addStringOption(option =>
            option.setName('giveaway_id')
                .setDescription('The ID of the giveaway to reroll')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('winners')
                .setDescription('Number of winners to reroll')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('glist')
        .setDescription('List active giveaways'),
    
    new SlashCommandBuilder()
        .setName('gactivity')
        .setDescription('View activity stats')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check activity for')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('gconfig')
        .setDescription('Configure giveaway settings')
        .addNumberOption(option =>
            option.setName('activity_multiplier')
                .setDescription('Activity bonus multiplier (default: 1.5)')
                .setRequired(false))
        .addNumberOption(option =>
            option.setName('max_activity_bonus')
                .setDescription('Maximum activity bonus (default: 5.0)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('message_points')
                .setDescription('Points per message (default: 1)')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('decay_days')
                .setDescription('Activity decay period in days (default: 30)')
                .setRequired(false))
];

// Event handlers
client.once('ready', async () => {
    console.log(`${client.user.tag} is online!`);
    
    // Register slash commands
    try {
        await client.application.commands.set(commands);
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
    
    // Check for expired giveaways
    setInterval(checkExpiredGiveaways, 60000); // Check every minute
});

client.on('messageCreate', (message) => {
    if (!message.guild || message.author.bot) return;
    updateActivity(message.author.id, message.guild.id, 'messages');
});

client.on('messageReactionAdd', (reaction, user) => {
    if (!reaction.message.guild || user.bot) return;
    updateActivity(user.id, reaction.message.guild.id, 'reactions');
});

client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand()) {
        await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
        await handleButton(interaction);
    }
});

async function handleSlashCommand(interaction) {
    const { commandName, options } = interaction;
    
    try {
        switch (commandName) {
            case 'giveaway':
                if (!hasAdminPermissions(interaction.member)) {
                    return await interaction.reply({ content: 'You need administrator permissions or the admin role to use this command.', ephemeral: true });
                }
                await createGiveawayCommand(interaction);
                break;
            case 'gend':
                if (!hasAdminPermissions(interaction.member)) {
                    return await interaction.reply({ content: 'You need administrator permissions or the admin role to use this command.', ephemeral: true });
                }
                await endGiveawayCommand(interaction);
                break;
            case 'greroll':
                if (!hasAdminPermissions(interaction.member)) {
                    return await interaction.reply({ content: 'You need administrator permissions or the admin role to use this command.', ephemeral: true });
                }
                await rerollGiveawayCommand(interaction);
                break;
            case 'glist':
                await listGiveawaysCommand(interaction);
                break;
            case 'gactivity':
                await activityCommand(interaction);
                break;
            case 'gconfig':
                if (!hasAdminPermissions(interaction.member)) {
                    return await interaction.reply({ content: 'You need administrator permissions or the admin role to use this command.', ephemeral: true });
                }
                await configCommand(interaction);
                break;
        }
    } catch (error) {
        console.error('Error handling slash command:', error);
        await interaction.reply({ content: 'An error occurred while processing your command.', ephemeral: true });
    }
}

async function createGiveawayCommand(interaction) {
    const prize = interaction.options.getString('prize');
    const duration = interaction.options.getInteger('duration');
    const winners = interaction.options.getInteger('winners');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const requirements = interaction.options.getString('requirements') || 'None';
    const description = interaction.options.getString('description') || '';
    const activityBonus = interaction.options.getBoolean('activity_bonus') ?? true;
    
    if (duration < 1 || duration > 10080) { // Max 1 week
        return await interaction.reply({ content: 'Duration must be between 1 and 10080 minutes (1 week).', ephemeral: true });
    }
    
    if (winners < 1 || winners > 20) {
        return await interaction.reply({ content: 'Number of winners must be between 1 and 20.', ephemeral: true });
    }
    
    const endTime = Date.now() + (duration * 60 * 1000);
    const giveawayId = createGiveaway(interaction.guild.id, channel.id, {
        prize,
        endTime,
        winners,
        requirements,
        description,
        activityBonus,
        hostId: interaction.user.id
    });
    
    const embed = new EmbedBuilder()
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`**Prize:** ${prize}\n${description ? `**Description:** ${description}\n` : ''}**Winners:** ${winners}\n**Requirements:** ${requirements}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>\n**Activity Bonus:** ${activityBonus ? '✅ Enabled' : '❌ Disabled'}\n\nClick the buttons below to enter or leave!`)
        .setColor(0x00ff00)
        .setFooter({ text: `Giveaway ID: ${giveawayId} | Hosted by ${interaction.user.tag}` })
        .setTimestamp();
    
    const buttons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`giveaway_enter_${giveawayId}`)
                .setLabel('🎉 Enter Giveaway')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`giveaway_leave_${giveawayId}`)
                .setLabel('❌ Leave Giveaway')
                .setStyle(ButtonStyle.Danger)
        );
    
    const giveawayMessage = await channel.send({ embeds: [embed], components: [buttons] });
    
    // Update giveaway with message ID
    giveaways[giveawayId].messageId = giveawayMessage.id;
    saveData(GIVEAWAYS_FILE, giveaways);
    
    await interaction.reply({ content: `Giveaway created successfully in ${channel}!`, ephemeral: true });
}

async function endGiveawayCommand(interaction) {
    const giveawayId = interaction.options.getString('giveaway_id');
    const giveaway = giveaways[giveawayId];
    
    if (!giveaway || giveaway.guildId !== interaction.guild.id) {
        return await interaction.reply({ content: 'Giveaway not found or not in this server.', ephemeral: true });
    }
    
    if (!giveaway.active) {
        return await interaction.reply({ content: 'This giveaway has already ended.', ephemeral: true });
    }
    
    await finishGiveaway(giveawayId);
    await interaction.reply({ content: 'Giveaway ended successfully!', ephemeral: true });
}

async function rerollGiveawayCommand(interaction) {
    const giveawayId = interaction.options.getString('giveaway_id');
    const winnersCount = interaction.options.getInteger('winners') || 1;
    const giveaway = giveaways[giveawayId];
    
    if (!giveaway || giveaway.guildId !== interaction.guild.id) {
        return await interaction.reply({ content: 'Giveaway not found or not in this server.', ephemeral: true });
    }
    
    if (giveaway.active) {
        return await interaction.reply({ content: 'Cannot reroll an active giveaway.', ephemeral: true });
    }
    
    const winners = selectWinners(giveawayId, winnersCount);
    
    if (winners.length === 0) {
        return await interaction.reply({ content: 'No valid entries to reroll.', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
        .setTitle('🎉 GIVEAWAY REROLLED 🎉')
        .setDescription(`**Prize:** ${giveaway.prize}\n**New Winner${winners.length > 1 ? 's' : ''}:** ${winners.map(w => `<@${w}>`).join(', ')}\n\nCongratulations!`)
        .setColor(0xffff00)
        .setFooter({ text: `Giveaway ID: ${giveawayId} | Rerolled by ${interaction.user.tag}` })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function listGiveawaysCommand(interaction) {
    const activeGiveaways = Object.values(giveaways).filter(g => g.active && g.guildId === interaction.guild.id);
    
    if (activeGiveaways.length === 0) {
        return await interaction.reply({ content: 'No active giveaways in this server.', ephemeral: true });
    }
    
    const embed = new EmbedBuilder()
        .setTitle('Active Giveaways')
        .setColor(0x00ff00)
        .setDescription(activeGiveaways.map(g => 
            `**${g.prize}** (ID: ${g.id})\nEnds: <t:${Math.floor(g.endTime / 1000)}:R>\nEntries: ${g.entries.length}\n`
        ).join('\n'))
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function activityCommand(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const activityScore = getActivityScore(user.id, interaction.guild.id);
    const key = `${interaction.guild.id}_${user.id}`;
    const userActivity = activity[key] || { messages: 0, reactions: 0, voiceMinutes: 0 };
    
    const embed = new EmbedBuilder()
        .setTitle(`Activity Stats for ${user.tag}`)
        .addFields(
            { name: 'Messages', value: userActivity.messages.toString(), inline: true },
            { name: 'Reactions', value: userActivity.reactions.toString(), inline: true },
            { name: 'Voice Minutes', value: userActivity.voiceMinutes.toString(), inline: true },
            { name: 'Activity Multiplier', value: `${activityScore.toFixed(2)}x`, inline: true }
        )
        .setColor(0x0099ff)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function configCommand(interaction) {
    const activityMultiplier = interaction.options.getNumber('activity_multiplier');
    const maxActivityBonus = interaction.options.getNumber('max_activity_bonus');
    const messagePoints = interaction.options.getInteger('message_points');
    const decayDays = interaction.options.getInteger('decay_days');
    
    if (activityMultiplier !== null) config.activityMultiplier = activityMultiplier;
    if (maxActivityBonus !== null) config.maxActivityBonus = maxActivityBonus;
    if (messagePoints !== null) config.messagePointValue = messagePoints;
    if (decayDays !== null) config.activityDecayDays = decayDays;
    
    saveData(CONFIG_FILE, config);
    
    const embed = new EmbedBuilder()
        .setTitle('Configuration Updated')
        .addFields(
            { name: 'Activity Multiplier', value: config.activityMultiplier.toString(), inline: true },
            { name: 'Max Activity Bonus', value: config.maxActivityBonus.toString(), inline: true },
            { name: 'Message Points', value: config.messagePointValue.toString(), inline: true },
            { name: 'Decay Days', value: config.activityDecayDays.toString(), inline: true }
        )
        .setColor(0x00ff00)
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleButton(interaction) {
    if (interaction.customId.startsWith('giveaway_enter_')) {
        const giveawayId = interaction.customId.split('_')[2];
        const giveaway = giveaways[giveawayId];
        
        if (!giveaway || !giveaway.active) {
            return await interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
        }
        
        if (giveaway.entries.includes(interaction.user.id)) {
            return await interaction.reply({ content: 'You have already entered this giveaway!', ephemeral: true });
        }
        
        giveaway.entries.push(interaction.user.id);
        saveData(GIVEAWAYS_FILE, giveaways);
        
        const activityScore = getActivityScore(interaction.user.id, interaction.guild.id);
        
        await interaction.reply({ 
            content: `You have successfully entered the giveaway! ${giveaway.activityBonus ? `Your activity bonus: ${activityScore.toFixed(2)}x` : ''}`, 
            ephemeral: true 
        });
    } else if (interaction.customId.startsWith('giveaway_leave_')) {
        const giveawayId = interaction.customId.split('_')[2];
        const giveaway = giveaways[giveawayId];
        
        if (!giveaway || !giveaway.active) {
            return await interaction.reply({ content: 'This giveaway is no longer active.', ephemeral: true });
        }
        
        if (!giveaway.entries.includes(interaction.user.id)) {
            return await interaction.reply({ content: 'You are not entered in this giveaway!', ephemeral: true });
        }
        
        giveaway.entries = giveaway.entries.filter(id => id !== interaction.user.id);
        saveData(GIVEAWAYS_FILE, giveaways);
        
        await interaction.reply({ 
            content: 'You have successfully left the giveaway!', 
            ephemeral: true 
        });
    }
}

async function checkExpiredGiveaways() {
    const now = Date.now();
    const expiredGiveaways = Object.values(giveaways).filter(g => g.active && g.endTime <= now);
    
    for (const giveaway of expiredGiveaways) {
        await finishGiveaway(giveaway.id);
    }
}

async function finishGiveaway(giveawayId) {
    const giveaway = giveaways[giveawayId];
    if (!giveaway || !giveaway.active) return;
    
    endGiveaway(giveawayId);
    
    try {
        const guild = client.guilds.cache.get(giveaway.guildId);
        const channel = guild.channels.cache.get(giveaway.channelId);
        
        if (!channel) return;
        
        const winners = selectWinners(giveawayId, giveaway.winners);
        
        let resultEmbed;
        if (winners.length === 0) {
            resultEmbed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY ENDED 🎉')
                .setDescription(`**Prize:** ${giveaway.prize}\n**Winner:** No valid entries\n\nBetter luck next time!`)
                .setColor(0xff0000)
                .setFooter({ text: `Giveaway ID: ${giveawayId}` })
                .setTimestamp();
        } else {
            resultEmbed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY ENDED 🎉')
                .setDescription(`**Prize:** ${giveaway.prize}\n**Winner${winners.length > 1 ? 's' : ''}:** ${winners.map(w => `<@${w}>`).join(', ')}\n\nCongratulations!`)
                .setColor(0xffff00)
                .setFooter({ text: `Giveaway ID: ${giveawayId}` })
                .setTimestamp();
        }
        
        await channel.send({ embeds: [resultEmbed] });
        
        // Create winner channel if there are winners
        if (winners.length > 0) {
            try {
                const winnerChannel = await guild.channels.create({
                    name: `giveaway-${giveaway.prize.toLowerCase().replace(/\s+/g, '-').substring(0, 50)}`,
                    type: ChannelType.GuildText,
                    topic: `Winner channel for giveaway: ${giveaway.prize}`,
                    parent: null // No category
                });
                
                // Create winner announcement message
                const winnerPings = winners.map(w => `<@${w}>`).join(' ');
                const adminPing = `<@&${ADMIN_ROLE_ID}>`;
                
                const winnerEmbed = new EmbedBuilder()
                    .setTitle('🎉 GIVEAWAY WINNERS 🎉')
                    .setDescription(`**Prize:** ${giveaway.prize}\n**Winner${winners.length > 1 ? 's' : ''}:** ${winnerPings}\n\nCongratulations! Please contact the admin team to claim your prize.`)
                    .setColor(0x00ff00)
                    .setFooter({ text: `Giveaway ID: ${giveawayId}` })
                    .setTimestamp();
                
                await winnerChannel.send({
                    content: `${winnerPings} ${adminPing}`,
                    embeds: [winnerEmbed]
                });
                
            } catch (error) {
                console.error('Error creating winner channel:', error);
            }
        }
        
        // Update original message
        if (giveaway.messageId) {
            try {
                const originalMessage = await channel.messages.fetch(giveaway.messageId);
                const disabledButtons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('giveaway_ended_enter')
                            .setLabel('Giveaway Ended')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true),
                        new ButtonBuilder()
                            .setCustomId('giveaway_ended_leave')
                            .setLabel('Giveaway Ended')
                            .setStyle(ButtonStyle.Secondary)
                            .setDisabled(true)
                    );
                
                await originalMessage.edit({ components: [disabledButtons] });
            } catch (error) {
                console.error('Error updating original message:', error);
            }
        }
        
    } catch (error) {
        console.error('Error finishing giveaway:', error);
    }
}

const token = process.env.TOKEN;
client.login(token);