import { IR, IROp, OPCODE_MAP } from "./bytecode.ts";
import { lex } from "./lexer.ts";
import { AssignmentNode, AssignmentSelectNode, ChoiceValueNode, DialogueNode, DocumentNode, ParseError, ScriptNode, TextNode, TextNodeChild, parse } from "./parser.ts";

interface CompilerState {
    characterIdNext: number;
    characters: Map<string, number>; 
    stringIdNext: number;
    strings: Map<string, number>;
    variableIdNext: number;
    variables: Map<string, number>;
}

function getCharacterId(state: CompilerState, name: string) {
    const existing = state.characters.get(name);
    if (existing !== undefined)
        return existing;
    const id = state.characterIdNext++;
    state.characters.set(name, id);
    return id;
}

function getStringId(state: CompilerState, text: string) {
    const existing = state.strings.get(text);
    if (existing !== undefined)
        return existing;
    const id = state.stringIdNext++;
    state.strings.set(text, id);
    return id;
}

function getVariableId(state: CompilerState, name: string) {
    const existing = state.variables.get(name);
    if (existing !== undefined)
        return existing;
    const id = state.variableIdNext++;
    state.variables.set(name, id);
    return id;
}

function compileScript(node: ScriptNode, state: CompilerState): IR[] {
    const ir: IR[] = compileTextNode(node, state);
    ir.push({type: "EvaluateScript"});
    return ir;
}

function compileTextNodeChild(child: TextNodeChild, state: CompilerState): IR[] {
    switch (child.type) {
        case 'Script':
            return compileScript(child, state);

        case 'Expression':
            return [
                {
                    type: "ReadVariable",
                    variable: getVariableId(state, child.key)
                }
            ]

        case 'String':
            return [
                {
                    type: "ReadStr",
                    string: getStringId(state, child.contents)
                }
            ]

        case "Text":
            return compileTextNode(child, state);
    
        default:
            throw new Error(`Unreachable code reached`);
    }
}

function compileTextNode(node: TextNode | ScriptNode, state: CompilerState): IR[] {
    const ir: IR[] = [];
    let isFirstNode = true;
    for (const child of node.contents) {
        ir.push(...compileTextNodeChild(child, state));
        if (isFirstNode) isFirstNode = false;
        else ir.push({type: "Concatenate"});
    }
    return ir;
}

function compileDialogue(dialogue: DialogueNode, state: CompilerState) {
    const characterId = dialogue.speaker ? getCharacterId(state, dialogue.speaker) : undefined;
    const ir: IR[] = [];
    if (characterId !== undefined) {
        ir.push({
            type: "SetCharacter",
            character: characterId
        });
    }
    ir.push(...compileTextNode(dialogue.contents, state));
    ir.push({
        type: "ShowDialogue",
        enclosed: dialogue.contents.enclosed
    });
    return ir;
}

function compileAssignment(assignment: AssignmentNode, state: CompilerState) {
    const ir: IR[] = [];
    ir.push(...compileTextNode(assignment.value, state));
    if (assignment.isPrompt)
        ir.push({
            type: "Prompt"
        });
    ir.push({
        type: "SetVariable",
        variable: getVariableId(state, assignment.key)
    });
    return ir;
}

function compileAssignmentSelect(assignment: AssignmentSelectNode, state: CompilerState) {
    // MovRegReg - store the current stack pointer in a register
    // ReadString - read the prompt string into a stack
    // ReadString - read value into a stack
    // SubRegReg - get the amount of options added to the stack
    // PickOption - pick an option from the stack with length from the register
    const ir: IR[] = [
        {
            type: "MoveRegReg",
            from: 1, // SP
            to: 3 // R0 (PC, SP, CPSR, R0-R2)
        }
    ];

    function compileChoiceValue(value: ChoiceValueNode) {
        const ir: IR[] = [];
        ir.push(...compileTextNode(value.prompt, state));
        ir.push({
            type: "ReadStr",
            string: getStringId(state, value.key) // TODO: might be changed to a number for smaller bytecode
        });
        return ir;
    }

    for (const option of assignment.options) {
        // AssignmentChoice
        const value = option.value;
        // ChoiceValue
        ir.push(...compileChoiceValue(value));
    }

    ir.push({
        type: "SubRegReg",
        into: 3, // R0
        registerLeft: 1, // SP
        registerRight: 3 // R0
    });
    // current - last = length

    ir.push({
        type: "PickOption",
        register: 3
    });

    ir.push({
        type: "SetVariable",
        variable: getVariableId(state, assignment.key)
    });

    return ir;
}

export function compileIR(document: DocumentNode, state: CompilerState) {
    const ir: IR[] = [
        {
            type: "Label",
            target: 0
        }
    ];
    for (const node of document.contents) {
        if (node.type === "Dialogue")
            ir.push(...compileDialogue(node, state));
        if (node.type === 'Assignment')
            ir.push(...compileAssignment(node, state));
        if (node.type === 'AssignmentSelect')
            ir.push(...compileAssignmentSelect(node, state));
    }
    ir.push({
        type: "EndOfScript"
    });
    return ir;
}

function operandOp(op: IROp['type'], ...operands: number[]): Uint8Array {
    const buf = new Uint8Array(4 * (1 + operands.length));
    const view = new DataView(buf.buffer);
    view.setUint32(0, OPCODE_MAP[op], true);
    for (let i = 0; i < operands.length; i++) {
        view.setUint32(4 + i * 4, operands[i], true);
    }
    return buf;
}

function operandOp8(op: IROp['type'], ...operands: number[]): Uint8Array {
    const buf = new Uint8Array(4 + operands.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, OPCODE_MAP[op], true);
    for (let i = 0; i < operands.length; i++) {
        view.setUint8(4 + i, operands[i]);
    }
    return buf;
}

function stringData(str: string): Uint8Array {
    return new TextEncoder().encode(str);
}

export function compileBytecode(ir: IR[], state: CompilerState): ArrayBuffer {
    const labelSubstitutions: [number, number][] = [];
    const stringSubstitutions: [number, number][] = [];
    const variableSubstitutions: [number, number][] = [];
    const characterSubstitutions: [number, number][] = [];
    const labels = new Map<number, number>();
    const stringLabels = new Map<number, number>();
    const variableLabels = new Map<number, number>();
    const characterLabels = new Map<number, number>();

    const bytecode: Uint8Array[] = [];

    let current = 0;

    function pushBytecode(bc: Uint8Array) {
        bytecode.push(bc);
        current += bc.byteLength;
    }

    const orderedVariables = [...state.variables.entries()].sort((a, b) => a[1] - b[1]);

    // first we load all the variable names such that the VM may interact with them
    for (const [, id] of orderedVariables) {
        pushBytecode(operandOp("SetVariableName", 0));
        variableSubstitutions.push([id, current - 4]);
    }

    // add a jump to jump over the symbol table
    pushBytecode(operandOp("Jump", 0));
    labelSubstitutions.push([0, current - 4]);

    // write the symbol table
    for (const [variable, id] of orderedVariables) {
        variableLabels.set(id, current);
        pushBytecode(stringData(variable));
        pushBytecode(new Uint8Array([0]));
    }

    for (const [string, id] of state.strings.entries()) {
        stringLabels.set(id, current);
        console.log('added string', string, id, current);
        pushBytecode(stringData(string));
        pushBytecode(new Uint8Array([0]));
    }

    for (const [character, id] of state.characters.entries()) {
        characterLabels.set(id, current);
        pushBytecode(stringData(character));
        pushBytecode(new Uint8Array([0]));
    }

    // convert the IR to bytecode
    for (const irOp of ir) {
        switch (irOp.type) {
            case 'Label':
                labels.set(irOp.target, current);
                break;
        
            case 'ReadStr':
                pushBytecode(operandOp("ReadStr", irOp.string));
                stringSubstitutions.push([irOp.string, current - 4]);
                break;

            case 'SetCharacter':
                pushBytecode(operandOp("SetCharacter", irOp.character));
                characterSubstitutions.push([irOp.character, current - 4]);
                break;

            case 'ShowDialogue':
                // TODO: op code for enclosed dialogue
                pushBytecode(operandOp("ShowDialogue", irOp.enclosed ? 1 : 0));
                break;

            case 'EvaluateScript':
                pushBytecode(operandOp("EvaluateScript"));
                break;

            case 'Concatenate':
                pushBytecode(operandOp("Concatenate"));
                break;

            case 'ReadVariable':
                pushBytecode(operandOp("ReadVariable", irOp.variable));
                break;

            case 'Jump':
                pushBytecode(operandOp("Jump", irOp.target));
                labelSubstitutions.push([irOp.target, current - 4]);
                break;

            case 'SetVariableName':
                pushBytecode(operandOp("SetVariableName", irOp.variable));
                variableSubstitutions.push([irOp.variable, current - 4]);
                break;

            case 'EndOfScript':
                pushBytecode(operandOp("EndOfScript"));
                break;

            case 'SetVariable':
                pushBytecode(operandOp("SetVariable", irOp.variable));
                break;

            case 'Prompt':
                pushBytecode(operandOp("Prompt"));
                break;

            case 'MoveRegReg':
                pushBytecode(operandOp8("MoveRegReg", irOp.to, irOp.from));
                break;

            case 'SubRegReg':
                pushBytecode(operandOp8("SubRegReg", irOp.into, irOp.registerLeft, irOp.registerRight));
                break;

            case 'PickOption':
                pushBytecode(operandOp8("PickOption", irOp.register));
                break;

            default:
                throw new Error(`Unreachable code reached`);
        }
    }

    // combine the bytecode into a single buffer
    const buffer = new ArrayBuffer(current);
    const view = new DataView(buffer);
    let offset = 0;
    for (const bc of bytecode) {
        for (let i = 0; i < bc.byteLength; i++) {
            view.setUint8(offset++, bc[i]);
        }
    }

    // now we substitute the labels
    for (const [id, label] of labelSubstitutions) {
        const target = labels.get(id);
        if (target === undefined)
            throw new Error(`Label ${id} not found`);
        view.setUint32(label, target, true);
    }

    // now we substitute the strings
    for (const [id, label] of stringSubstitutions) {
        const target = stringLabels.get(id);
        console.log('substituting string', id, label, target);
        if (target === undefined)
            throw new Error(`String ${id} not found`);
        view.setUint32(label, target, true);
    }

    // now we substitute the variables
    for (const [id, label] of variableSubstitutions) {
        const target = variableLabels.get(id);
        if (target === undefined)
            throw new Error(`Variable ${id} not found`);
        view.setUint32(label, target, true);
    }

    // now we substitute the characters
    for (const [id, label] of characterSubstitutions) {
        const target = characterLabels.get(id);
        if (target === undefined)
            throw new Error(`Character ${id} not found`);
        view.setUint32(label, target, true);
    }

    // return the buffer
    return buffer;
}

export function createCompiler(): CompilerState {
    return {
        characterIdNext: 0,
        characters: new Map(),
        stringIdNext: 0,
        strings: new Map(),
        variableIdNext: 0,
        variables: new Map()
    };
}

export function dumpSymbolTable(state: CompilerState) {
    return {
        characters: [...state.characters.entries()],
        strings: [...state.strings.entries()],
        variables: [...state.variables.entries()]
    }
}
