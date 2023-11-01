import { OPCODE_TO_IROp } from "./bytecode.ts";

interface VMState {
    stack: string[];
    reg: [
        number, // PC,
        number, // SP,
        number, // CPSR (current program status register), much like ARM
        number, // 3 (general purpose)
        number, // 4 (general purpose)
    ],
    nextVariableId: number;
    variableFromName: Map<string, number>;
    variableValues: Map<number, string>;
    character: number;
    bc: ArrayBuffer;
    view: DataView;
    toJSON(): unknown;
}

export function run(state: VMState) {
    const { view } = state;

    function read32() {
        const op = view.getUint32(state.reg[0], true);
        state.reg[0] += 4;
        return op;
    }

    function read8() {
        const op = view.getUint8(state.reg[0]);
        state.reg[0]++;
        return op;
    }

    function readStr(offset: number) {
        // read 1 byte at a time untill null terminator
        let current = offset;
        const bytes = [];
        
        while (true) {
            const byte = view.getUint8(current);
            current++;
            if (byte === 0)
                break;
            bytes.push(byte);
        }

        return new TextDecoder().decode(new Uint8Array(bytes));
    }

    function stackPush(value: string) {
        state.stack.push(value);
        state.reg[1]++;
    }

    function stackPop() {
        state.reg[1]--;
        return state.stack.pop();
    }

    while (true) {
        const opcode = read32();
        const op = OPCODE_TO_IROp[opcode];
        switch (op) {
            case 'Jump':
                state.reg[0] = read32();
                break;

            case "EndOfScript":
                if (state.stack.length > 0)
                    console.warn('WARN: Script ended with non-empty stack');
                return true;
        
            case 'ReadStr':
                stackPush(readStr(read32()));
                break;

            case 'SetCharacter':
                state.character = read32();
                break;

            case 'Concatenate':
                if (state.stack.length < 2)
                    throw new Error("Stack underflow");
                stackPush([stackPop()!, stackPop()!].reverse().join(''));
                break;

            case 'ShowDialogue':
                read32(); // TODO: ignore enclosed for now
                if (state.stack.length < 1)
                    throw new Error("Stack underflow");
                console.log(`<< ${readStr(state.character)}\n${stackPop()}\n`);
                return false;

            case 'EvaluateScript':
                {
                    const script = stackPop();
                    if (!script)
                        throw new Error("Stack underflow");
                    // TODO: feature complete scripting
                    const ret = new Function('vm', `return (${script})`)({
                        getVariable(name: string) {
                            return state.variableValues.get(state.variableFromName.get(name)!) || "";
                        }
                    });
                    stackPush(ret.toString());
                }
                break;

            case 'ReadVariable':
                stackPush(state.variableValues.get(read32()) || "");
                break;

            case 'SetVariableName':
                state.variableFromName.set(readStr(read32()), state.nextVariableId++);
                break;

            case 'SetVariable':
                {
                    const value = stackPop();
                    if (!value)
                        throw new Error("Stack underflow");
                    state.variableValues.set(read32(), value);
                }
                break;

            case 'Prompt':
                {
                    const promptMessage = stackPop();

                    if (!promptMessage)
                        throw new Error("Stack underflow");
                    const value = prompt('>> ' + promptMessage);
                    if (value === null)
                        throw new Error("Prompt cancelled");
                    stackPush(value);
                    console.log(''); // new line
                }
                break;

            case 'MoveRegReg':
                {
                    const reg = read8();
                    state.reg[reg] = state.reg[read8()];
                    if (reg === 1)
                        state.stack.length = state.reg[1];
                }
                break;

            case 'SubRegReg':
                state.reg[read8()] = state.reg[read8()] - state.reg[read8()];
                break;

            case 'PickOption':
                {
                    const oplen = state.reg[read8()];
                    const isEven = !(oplen & 1);
                    if (!isEven)
                        throw new Error("Odd option length in PickOption operand");
                    const opts = new Map<string, string>();
                    for (let i = 0; i < oplen; i += 2) {
                        const key = stackPop();
                        const value = stackPop();
                        if (!key || !value)
                            throw new Error("Stack underflow");
                        opts.set(key, value);
                    }
                    console.log(opts);
                    const value = prompt(">> Pick an option: " + [...opts.keys()].join(', ') + ":");
                    if (value === null)
                        throw new Error("Prompt cancelled");
                    const result = opts.get(value);
                    if (!result)
                        throw new Error("Invalid option");
                    stackPush(value);
                    console.log(''); // new line
                }
                break;

            default:
                throw new Error(`Unknown opcode: ${opcode}`);
        }
    }
}

export function createVM(bc: ArrayBuffer): VMState {
    const view = new DataView(bc);

    return {
        stack: [],
        reg: [
            0,
            0,
            0,
            0,
            0
        ],
        nextVariableId: 0,
        variableFromName: new Map(),
        variableValues: new Map(),
        character: 0,
        bc,
        view,
        toJSON() {
            return {
                stack: this.stack,
                reg: this.reg,
                nextVariableId: this.nextVariableId,
                variableFromName: [...this.variableFromName.entries()],
                variableValues: [...this.variableValues.entries()],
                character: this.character
            }
        }
    }
}