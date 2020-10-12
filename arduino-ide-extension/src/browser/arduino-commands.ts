import { Command } from '@theia/core/lib/common/command';

/**
 * @deprecated all these commands should go under contributions and have their command, menu, keybinding, and toolbar contributions.
 */
export namespace ArduinoCommands {

    export const TOGGLE_COMPILE_FOR_DEBUG: Command = {
        id: 'arduino-toggle-compile-for-debug'
    };

    export const OPEN_BOARDS_DIALOG: Command = {
        id: 'arduino-open-boards-dialog'
    };

    export const TOGGLE_ADVANCED_MODE: Command = {
        id: 'arduino-toggle-advanced-mode'
    };
    export const TOGGLE_ADVANCED_MODE_TOOLBAR: Command = {
        id: 'arduino-toggle-advanced-mode-toolbar'
    };

}
