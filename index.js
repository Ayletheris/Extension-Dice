import { animation_duration } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { POPUP_TYPE, callGenericPopup } from '../../../popup.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../../slash-commands/SlashCommandArgument.js';
import { commonEnumProviders } from '../../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { isTrueBoolean } from '../../../utils.js';
export { MODULE_NAME };

const MODULE_NAME = 'dice';
const TEMPLATE_PATH = 'third-party/Extension-Dice';

// Define default settings
const defaultSettings = Object.freeze({
    functionTool: false,
});

// Define a function to get or initialize settings
function getSettings() {
    const { extensionSettings } = SillyTavern.getContext();

    // Initialize settings if they don't exist
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // Ensure all default keys exist (helpful after updates)
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extensionSettings[MODULE_NAME];
}

/**
 * Roll dice with unique (non-repeating) values using a shuffled pool.
 * Requires a simple NdX formula (e.g., 3d6). Count must not exceed sides.
 * @param {string} formula Dice formula
 * @param {boolean} quiet Suppress chat output
 * @returns {{total: string, rolls: Array<string>}} Roll result
 */
function doDiceRollUnique(formula, quiet = false) {
    const nullValue = { total: '', rolls: [] };
    const match = formula.match(/^(\d+)d(\d+)$/i);
    if (!match) {
        toastr.warning('Unique rolls require a simple NdX formula (e.g., 3d6)');
        return nullValue;
    }
    const count = parseInt(match[1], 10);
    const sides = parseInt(match[2], 10);
    if (count > sides) {
        toastr.warning(`Cannot roll ${count} unique values on a d${sides} — not enough faces`);
        return nullValue;
    }
    // Fisher-Yates shuffle of [1..sides], take first `count`
    const pool = Array.from({ length: sides }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const rolls = pool.slice(0, count);
    const total = rolls.reduce((a, b) => a + b, 0);
    if (!quiet) {
        const context = SillyTavern.getContext();
        context.sendSystemMessage('generic', `${context.name1} rolls ${formula} (unique). The result is: ${total} (${rolls.join(', ')})`, { isSmallSys: true });
    }
    return { total: String(total), rolls: rolls.map(String) };
}

/**
 * Roll the dice.
 * @param {string} customDiceFormula Dice formula
 * @param {boolean} quiet Suppress chat output
 * @returns {Promise<{total: string, rolls: Array<string>}>} Roll result
 */
async function doDiceRoll(customDiceFormula, quiet = false) {
    const nullValue = { total: '', rolls: [] };

    let value = typeof customDiceFormula === 'string' ? customDiceFormula.trim() : $(this).data('value');

    if (value == 'custom') {
        value = await callGenericPopup('Enter the dice formula:<br><i>(for example, <tt>2d6</tt>)</i>', POPUP_TYPE.INPUT, '', { okButton: 'Roll', cancelButton: 'Cancel' });
    }

    if (!value) {
        return nullValue;
    }

    const isValid = SillyTavern.libs.droll.validate(value);

    if (isValid) {
        const result = SillyTavern.libs.droll.roll(value);
        if (!result) {
            return nullValue;
        }
        if (!quiet) {
            const context = SillyTavern.getContext();
            context.sendSystemMessage('generic', `${context.name1} rolls a ${value}. The result is: ${result.total} (${result.rolls.join(', ')})`, { isSmallSys: true });
        }
        return { total: String(result.total), rolls: result.rolls.map(String) };
    } else {
        toastr.warning('Invalid dice formula');
        return nullValue;
    }

}

async function addDiceRollButton() {
    const buttonHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'button');
    const dropdownHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'dropdown');
    const settingsHtml = await renderExtensionTemplateAsync(TEMPLATE_PATH, 'settings');

    const getWandContainer = () => $(document.getElementById('dice_wand_container') ?? document.getElementById('extensionsMenu'));
    getWandContainer().append(buttonHtml);

    const getSettingsContainer = () => $(document.getElementById('dice_container') ?? document.getElementById('extensions_settings2'));
    getSettingsContainer().append(settingsHtml);

    const settings = getSettings();
    $('#dice_function_tool').prop('checked', settings.functionTool).on('change', function () {
        settings.functionTool = !!$(this).prop('checked');
        SillyTavern.getContext().saveSettingsDebounced();
        registerFunctionTools();
    });

    $(document.body).append(dropdownHtml);
    $('#dice_dropdown li').on('click', function () {
        dropdown.fadeOut(animation_duration);
        doDiceRoll($(this).data('value'), false);
    });
    const button = $('#roll_dice');
    const dropdown = $('#dice_dropdown');
    dropdown.hide();

    const popper = SillyTavern.libs.Popper.createPopper(button.get(0), dropdown.get(0), {
        placement: 'top',
    });

    $(document).on('click touchend', function (e) {
        const target = $(e.target);
        if (target.is(dropdown) || target.closest(dropdown).length) return;
        if (target.is(button) && !dropdown.is(':visible')) {
            e.preventDefault();

            dropdown.fadeIn(animation_duration);
            popper.update();
        } else {
            dropdown.fadeOut(animation_duration);
        }
    });
}

function registerFunctionTools() {
    try {
        const { registerFunctionTool, unregisterFunctionTool } = SillyTavern.getContext();
        if (!registerFunctionTool || !unregisterFunctionTool) {
            console.debug('Dice: function tools are not supported');
            return;
        }

        unregisterFunctionTool('RollTheDice');

        // Function tool is disabled by the settings
        const settings = getSettings();
        if (!settings.functionTool) {
            return;
        }

        const rollDiceSchema = Object.freeze({
            $schema: 'http://json-schema.org/draft-04/schema#',
            type: 'object',
            properties: {
                who: {
                    type: 'string',
                    description: 'The name of the persona rolling the dice',
                },
                formula: {
                    type: 'string',
                    description: 'A dice formula to roll, e.g. 2d6. When using items, only the die face matters (e.g. d100) — the count is ignored and derived from the items list instead.',
                },
                unique: {
                    type: 'boolean',
                    description: 'If true, each die in the roll will show a different value (no repeats). Use when the user explicitly asks for unique or non-repeating rolls, or when the context implies drawing without replacement, picking distinct outcomes, or when results must all differ — e.g. "roll unique", "unique roll", "no repeats", "draw 3 cards", "assign different scores to each stat", "no two results can be the same".',
                },
                items: {
                    type: 'array',
                    items: { type: 'string' },
            description: 'REQUIRED when assigning rolls to named things (tags, scenes, characters, options, etc.). Pass the full list here — one die is rolled per entry and results come back as "item: roll" pairs. Never use NdX counting and map the indices yourself; always use this parameter for named lists.',
                },
            },
            required: [
                'who',
                'formula',
                'items',
            ],
        });

        registerFunctionTool({
            name: 'RollTheDice',
            displayName: 'Dice Roll',
            description: 'Rolls dice and returns final results. Call this tool ONCE per task — the results are final, do not re-roll. Two modes: (1) NAMED MODE — when assigning a roll to each item in a list (tags, scenes, characters, options, etc.), you MUST use the items parameter; pass the complete list and the die face in formula (e.g. d100), and get back item:roll pairs. Do NOT use NdX counting and map manually — always use items for named lists. (2) PLAIN MODE — for a simple roll with no named items, use a standard formula like 2d6.',
            parameters: rollDiceSchema,
            action: async (args) => {
                if (!args?.formula) args = { formula: '1d6' };

                // Named-item mode: derive count from the items array
                if (Array.isArray(args.items) && args.items.length > 0) {
                    const dieFace = (args.formula.match(/d\d+/i) ?? ['d6'])[0];
                    const adjustedFormula = `${args.items.length}${dieFace}`;
                    const roll = args.unique
                        ? doDiceRollUnique(adjustedFormula, true)
                        : await doDiceRoll(adjustedFormula, true);
                    const pairs = args.items.map((item, i) => `${item}: ${roll.rolls[i] ?? '?'}`).join('\n');
                    return `Rolls (${dieFace}${args.unique ? ', unique' : ''}):\n${pairs}`;
                }

                // Standard mode
                const roll = args.unique
                    ? doDiceRollUnique(args.formula, true)
                    : await doDiceRoll(args.formula, true);
                const uniqueNote = args.unique ? ' (unique)' : '';
                const indexedRolls = roll.rolls.map((r, i) => `[${i}] ${r}`).join(', ');
                const result = args.who
                    ? `${args.who} rolls ${args.formula}${uniqueNote}. Total: ${roll.total}. Rolls by index: ${indexedRolls}`
                    : `${args.formula}${uniqueNote} roll. Total: ${roll.total}. Rolls by index: ${indexedRolls}`;
                return result;
            },
            formatMessage: () => '',
        });
    } catch (error) {
        console.error('Dice: Error registering function tools', error);
    }
}

jQuery(async function () {
    await addDiceRollButton();
    registerFunctionTools();
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'roll',
        aliases: ['r'],
        callback: async (args, value) => {
            const quiet = isTrueBoolean(String(args.quiet));
            const unique = isTrueBoolean(String(args.unique ?? 'false'));
            const formula = String(value || '1d6');
            const result = unique ? doDiceRollUnique(formula, quiet) : await doDiceRoll(formula, quiet);
            return result.total;
        },
        helpString: 'Roll the dice.',
        returns: 'roll result',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: 'Do not display the result in chat',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: String(false),
                enumProvider: commonEnumProviders.boolean('trueFalse'),
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'unique',
                description: 'Ensure no repeated values across all dice in the roll',
                isRequired: false,
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                defaultValue: String(false),
                enumProvider: commonEnumProviders.boolean('trueFalse'),
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: 'dice formula, e.g. 2d6',
                isRequired: true,
                typeList: [ARGUMENT_TYPE.STRING],
            }),
        ],
    }));
});
