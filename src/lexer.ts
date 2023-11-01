interface ScriptCursor {
    line: number;
    column: number;
    index: number;
}

interface LexerState {
    input: string;
    cursorStack: ScriptCursor[];
}

interface BaseToken {
    range: [ScriptCursor, ScriptCursor];
}

interface Word extends BaseToken {
    type: "Word";
    text: string;
}

interface Whitespace extends BaseToken {
    type: "Whitespace";
    text: string;
}

interface NewLine extends BaseToken {
    type: "NewLine";
}

const STRING_ENCLOSURES = ["'", '"', "`", "{", "}"] as const;

export interface EnclosedTextIndicator extends BaseToken {
    type: "EnclosedTextIndicator";
    enclosure: typeof STRING_ENCLOSURES[number];
}

const SPECIAL_CHARACTERS = ["*", "_", '@', ':', '\\', '=', '<', '?'] as const;

interface SpecialCharacter extends BaseToken {
    type: "SpecialCharacter";
    character: typeof SPECIAL_CHARACTERS[number];
}

interface Variable extends BaseToken {
    type: "Variable";
    name: string;
}

interface ScriptEnd extends BaseToken {
    type: "ScriptEnd";
}

type Token = Word | Whitespace | NewLine | EnclosedTextIndicator | SpecialCharacter | ScriptEnd | Variable;

function currentCursor(lexer: LexerState) {
    const cursor = lexer.cursorStack[lexer.cursorStack.length - 1];
    return cursor;
}

function currentChar(lexer: LexerState) {
    return lexer.input.charAt(currentCursor(lexer).index);
}

function advanceCursor(lexer: LexerState) {
    const cursor = currentCursor(lexer);
    const isNewline = currentChar(lexer) === "\n";
    cursor.index++;
    cursor.column++;
    if (isNewline) {
        cursor.line++;
        cursor.column = 0;
    }
}

function isEOF(lexer: LexerState) {
    return currentCursor(lexer).index >= lexer.input.length;
}

function cloneAndPushCursor(lexer: LexerState) {
    const cursor = currentCursor(lexer);
    lexer.cursorStack.push({...cursor});
}

const WHITESPACE_CHARS = new Set([" ", "\t", "\r"]);

function readWhitespace(lexer: LexerState): Whitespace {
    cloneAndPushCursor(lexer);
    let whitespace = "";
    while (!isEOF(lexer) && WHITESPACE_CHARS.has(currentChar(lexer))) {
        whitespace += currentChar(lexer);
        advanceCursor(lexer);
    }
    const end = currentCursor(lexer);
    const start = lexer.cursorStack.shift()!;
    return {type: "Whitespace", range: [start, end], text: whitespace};
}

function readNewline(lexer: LexerState): NewLine {
    cloneAndPushCursor(lexer);
    advanceCursor(lexer);
    const end = currentCursor(lexer);
    const start = lexer.cursorStack.shift()!;
    return {type: "NewLine", range: [start, end]};
}

function readEnclosedTextIndicator(lexer: LexerState): EnclosedTextIndicator {
    cloneAndPushCursor(lexer);
    const enclosure = currentChar(lexer);
    advanceCursor(lexer);
    const end = currentCursor(lexer);
    const start = lexer.cursorStack.shift()!;
    return {type: "EnclosedTextIndicator", range: [start, end], enclosure} as EnclosedTextIndicator;
}

function readSpecialCharacter(lexer: LexerState): SpecialCharacter {
    cloneAndPushCursor(lexer);
    const character = currentChar(lexer);
    advanceCursor(lexer);
    const end = currentCursor(lexer);
    const start = lexer.cursorStack.shift()!;
    return {type: "SpecialCharacter", range: [start, end], character} as SpecialCharacter;
}

const TEXT_TERMINATORS = new Set([...WHITESPACE_CHARS, ...STRING_ENCLOSURES, ...SPECIAL_CHARACTERS, "\n"]);

function readWord(lexer: LexerState): Word {
    cloneAndPushCursor(lexer);
    let text = "";
    while (!isEOF(lexer) && !TEXT_TERMINATORS.has(currentChar(lexer))) {
        text += currentChar(lexer);
        advanceCursor(lexer);
    }
    const end = currentCursor(lexer);
    const start = lexer.cursorStack.shift()!;
    return {type: "Word", range: [start, end], text};
}


const alphaNumericRegex = /[a-zA-Z0-9]/;

function readVariable(lexer: LexerState): Variable {
    cloneAndPushCursor(lexer);
    advanceCursor(lexer);
    let name = "";
    while (!isEOF(lexer) && alphaNumericRegex.test(currentChar(lexer))) {
        name += currentChar(lexer);
        advanceCursor(lexer);
    }
    const end = currentCursor(lexer);
    const start = lexer.cursorStack.shift()!;
    return {type: "Variable", range: [start, end], name};
}

function getNextToken(lexer: LexerState): Token {
    const current = currentChar(lexer);

    if (isEOF(lexer)) 
        return {type: "ScriptEnd", range: [currentCursor(lexer), currentCursor(lexer)]} as ScriptEnd;

    switch (current) {
        case ' ':
        case '\t':
        case '\r':
            return readWhitespace(lexer);

        case '\n':
            return readNewline(lexer);

        case '"':
        case "'":
        case "`":
        case "{":
        case "}":
            return readEnclosedTextIndicator(lexer);

        case '*':
        case '_':
        case '@':
        case ':':
        case '\\':
        case '=':
        case '<':
        case '?':
            return readSpecialCharacter(lexer);

        case '$':
            return readVariable(lexer);
    
        default:
            return readWord(lexer);
    }
}

function createLexer(input: string): LexerState {
    return {
        input,
        cursorStack: [{line: 1, column: 1, index: 0}]
    };
}

function* tokenGenerator(lexer: LexerState): Generator<Token, undefined, unknown> {
    while (true) {
        const token = getNextToken(lexer);
        console.log('token', token);
        yield token;
        if (token.type === "ScriptEnd")
            break;
    }
    return undefined;
}

function lex(input: string) {
    const lexer = createLexer(input);
    const gen = tokenGenerator(lexer);
    let peaked = gen.next();
    let current = peaked;
    const stackCurrent: IteratorResult<Token, undefined>[] = [];
    return {
        next() {
            current = peaked;
            peaked = gen.next();
            return current;
        },
        peek() {
            return peaked;
        },
        current() {
            return current;
        },
        isEOF() {
            return isEOF(lexer);
        },
        pushCurrent() {
            cloneAndPushCursor(lexer);
            stackCurrent.push(peaked);
            stackCurrent.push(current);
        },
        popCurrent() {
            lexer.cursorStack.pop();
            current = stackCurrent.pop()!;
            peaked = stackCurrent.pop()!;
        },
        shiftLast() {
            lexer.cursorStack.shift();
            stackCurrent.pop();
            stackCurrent.pop();        
        }
    }
}

type Lexer = ReturnType<typeof lex>;

export {
    tokenGenerator, createLexer, lex,
    type Token, type ScriptCursor, type LexerState, type Lexer
};