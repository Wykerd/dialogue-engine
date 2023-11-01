import { EnclosedTextIndicator } from "./lexer.ts";

export interface ReadStrOp {
    type: "ReadStr";
    string: number;
}

export interface SetCharacterOp {
    type: "SetCharacter";
    character: number;
}

export interface ReadVariableOp {
    type: "ReadVariable";
    variable: number;
}

export interface SetVariableOp {
    type: "SetVariable";
    variable: number;
}

export interface SetVariableName {
    type: "SetVariableName";
    variable: number;
}

export interface ShowDialogueOp {
    type: "ShowDialogue";
    enclosed?: EnclosedTextIndicator['enclosure'];
}

export interface EvaluateScriptOp {
    type: "EvaluateScript";
}

export interface ConcatenateOp {
    type: "Concatenate";
}

export interface JumpOp {
    type: "Jump";
    target: number;
}

export interface LabelIR {
    type: "Label";
    target: number;
}

export interface EndOfScriptOp {
    type: "EndOfScript";
}

export interface PromptOp {
    type: "Prompt";
}

export interface MoveRegRegOp {
    type: "MoveRegReg";
    from: number;
    to: number;
}

export interface SubRegRegOp {
    type: "SubRegReg";
    into: number;
    registerLeft: number;
    registerRight: number;
}

export interface PickOptionOp {
    type: "PickOption",
    register: number;
}

export type IROp = ReadStrOp | SetCharacterOp | ShowDialogueOp | EvaluateScriptOp | ConcatenateOp | ReadVariableOp | SetVariableName | JumpOp | EndOfScriptOp | SetVariableOp | PromptOp | MoveRegRegOp | SubRegRegOp | PickOptionOp;

export type IR = IROp | LabelIR;

export const OPCODE_MAP: Record<IROp['type'], number> = {
    "ReadStr": 0,
    "SetCharacter": 1,
    "ShowDialogue": 2,
    "EvaluateScript": 3,
    "Concatenate": 4,
    "ReadVariable": 5,
    "SetVariableName": 6,
    "Jump": 7,
    "EndOfScript": 8,
    "SetVariable": 9,
    "Prompt": 10,
    "MoveRegReg": 11,
    "SubRegReg": 12,
    "PickOption": 13,
};

export const OPCODE_TO_IROp = Object.fromEntries(Object.entries(OPCODE_MAP).map(([key, value]) => [value, key])) as Record<number, IROp['type']>;
