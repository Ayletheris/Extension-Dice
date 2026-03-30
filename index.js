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
                    description: 'A dice formula to roll, e.g. 2d6',
                },
                unique: {
                    type: 'boolean',
                    description: 'If true, each die in the roll will show a different value (no repeats). Use when the user explicitly asks for unique or non-repeating rolls, or when the context implies drawing without replacement, picking distinct outcomes, or when results must all differ — e.g. "roll unique", "unique roll", "no repeats", "draw 3 cards", "assign different scores to each stat", "no two results can be the same".',
                },
            },
            required: [
                'who',
                'formula',
            ],
        });

        registerFunctionTool({
            name: 'RollTheDice',
            displayName: 'Dice Roll',
            description: 'Rolls the dice using the provided formula and returns the total and all individual roll values. To roll multiple dice at once, use a formula like 5d20 (rolls 5 twenty-sided dice in a single call). Never make multiple calls when a single NdX formula can cover all the rolls needed.',
            parameters: rollDiceSchema,
            action: async (args) => {
                if (!args?.formula) args = { formula: '1d6' };
                const roll = args.unique
                    ? doDiceRollUnique(args.formula, true)
                    : await doDiceRoll(args.formula, true);
                const uniqueNote = args.unique ? ' (unique)' : '';
                const result = args.who
                    ? `${args.who} rolls a ${args.formula}${uniqueNote}. The result is: ${roll.total}. Individual rolls: ${roll.rolls.join(', ')}`
                    : `The result of a ${args.formula}${uniqueNote} roll is: ${roll.total}. Individual rolls: ${roll.rolls.join(', ')}`;
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
