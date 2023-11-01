import { lex, Token, ScriptCursor, LexerState, Lexer, createLexer, EnclosedTextIndicator } from "./lexer.ts";

export class ParseError extends Error {
    constructor(message: string, public cursorStack: ScriptCursor[]) {
        super(message);
    }

    toString() {
        return `${this.message}\n    at ${this.cursorStack[this.cursorStack.length - 1].line}:${this.cursorStack[this.cursorStack.length - 1].column}`;
    }
}

interface ASTNode {};

export type TextNodeChild = TextNode | StringNode | ExpressionNode | ScriptNode;

export interface TextNode extends ASTNode {
    type: "Text";
    contents: TextNodeChild[];
    enclosed?: EnclosedTextIndicator['enclosure'];
}

interface StringNode extends ASTNode {
    type: "String";
    contents: string;
}

interface ExpressionNode extends ASTNode {
    type: "Expression";
    key: string;
}

export interface ScriptNode extends ASTNode {
    type: "Script";
    contents: TextNodeChild[];
}

export interface DialogueNode extends ASTNode {
    type: "Dialogue";
    speaker?: string;
    contents: TextNode;
}

export interface AssignmentNode extends ASTNode {
    type: "Assignment";
    key: string;
    value: TextNode;
    isPrompt: boolean;
}


// export interface IfStatementNode<T extends ASTNode> extends ASTNode {
//     type: "IfStatement";
//     condition: ConditionalNode;
//     trueBranch: T;
//     falseBranch?: T;
// }

// type ConditionalOperation = "==" | "!=" | "<" | ">" | "<=" | ">=";

// export interface ConditionalNode extends ASTNode {
//     type: "Conditional";
//     left: ExpressionNode | TextNode;
//     operation: ConditionalOperation;
//     right: ExpressionNode | TextNode;
// }

export interface ChoiceValueNode extends ASTNode {
    type: "ChoiceValue";
    prompt: TextNode;
    key: string;
}

export interface AssignmentChoiceNode extends ASTNode {
    type: "AssignmentChoice";
    value: ChoiceValueNode; // | IfStatementNode<ChoiceValueNode>;
}

export interface AssignmentSelectNode extends ASTNode {
    type: "AssignmentSelect";
    key: string;
    options: AssignmentChoiceNode[];
}

export interface DocumentNode extends ASTNode {
    type: "Document";
    contents: (DialogueNode | AssignmentNode | AssignmentSelectNode)[];
}

function skipWhitespace(lex: Lexer, includeNewline?: boolean) {
    while (true) {
        const token = lex.next().value;
        console.log('skipWhitespace', token)
        if (!token)
            throw new ParseError("Unexpected end of script", []);
        if (token.type !== 'Whitespace' && (!includeNewline || token.type !== 'NewLine'))
            return token;
    }
}

function parseString(lex: Lexer, firstToken: Token): StringNode {
    if (firstToken.type !== "Word")
        throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);

    let currentToken = firstToken as Token | undefined;
    let contents = ''

    while (currentToken && (currentToken.type === 'Word' || currentToken.type === 'Whitespace')) {
        contents += currentToken.text;
        currentToken = lex.next().value;
    }

    return {
        type: "String",
        contents: contents
    }
}

function parseEscapedCharacter(lex: Lexer, firstToken: Token): StringNode {
    if (firstToken.type !== "SpecialCharacter")
        throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);

    const {value: peaked, done: noPeak} = lex.peek();

    if (noPeak)
        throw new ParseError("Unexpected end of script", []);

    if (peaked.type !== 'SpecialCharacter' && peaked.type !== 'NewLine' && peaked.type !== 'EnclosedTextIndicator') {
        lex.next();
        return {
            type: "String",
            contents: firstToken.character
        }
    }

    const text = peaked.type === 'NewLine' ? '\n' : peaked.type === 'EnclosedTextIndicator' ? peaked.enclosure : peaked.character;

    console.log('escaped', peaked.type);

    lex.next();
    lex.next();

    return {
        type: "String",
        contents: text
    }
}

function parseExpression(lex: Lexer, firstToken: Token): ExpressionNode {
    if (firstToken.type !== "Variable")
        throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);

    lex.next();

    return {
        type: "Expression",
        key: firstToken.name
    }
}

function parseEnclosedTextNode(lex: Lexer, firstToken: Token, disallowTextString?: boolean): TextNode | StringNode | ScriptNode {
    if (firstToken.type !== "EnclosedTextIndicator")
        throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);

    if (disallowTextString && (firstToken.enclosure === '"' || firstToken.enclosure === "'")) {
        lex.next();
        return {
            type: "String",
            contents: firstToken.enclosure
        }
    }

    const enclosedEnd = firstToken.enclosure === '{' ? '}' : firstToken.enclosure;

    if (firstToken.enclosure === '{') {
        return {
            type: "Script",
            contents: parseTextNodeChildren(lex, lex.next().value, enclosedEnd, '{', 0)
        }
    }

    return {
        type: "Text",
        contents: parseTextNodeChildren(lex, lex.next().value, enclosedEnd),
        enclosed: firstToken.enclosure
    } 
}

function parseTextNodeChildren(lex: Lexer, firstToken?: Token, enclosedEnd?: string, ignoreEnclosureStart?: string, ignoreEnclosureEndCount?: number): TextNodeChild[] {
    let ignoreEnclosureEndCountCurrent = ignoreEnclosureEndCount || 0;

    if (!firstToken)
        throw new ParseError("Unexpected end of script", []);

    const children: TextNodeChild[] = [];

    let currentToken: Token | undefined = firstToken;

    function pushChild(child: TextNodeChild) {
        const lastChild = children[children.length - 1];
        if (child.type === 'String' && lastChild && lastChild.type === 'String') {
            // Merge strings
            lastChild.contents += child.contents;
        }
        else {
            children.push(child);
        }
    }

    // while we have a current token, its not the end of the script and the current token is not a newline unless we are in an enclosed text node

    while (currentToken && (enclosedEnd || currentToken.type !== 'NewLine') && currentToken.type !== 'ScriptEnd') {
        console.log('iterating', currentToken)
        if (currentToken.type === 'Word') {
            pushChild(parseString(lex, currentToken));
            currentToken = lex.current().value;
            continue;
        }

        if (currentToken.type === 'SpecialCharacter') {
            if (currentToken.character === '\\') {
                console.log('escaping');
                pushChild(parseEscapedCharacter(lex, currentToken));
                currentToken = lex.current().value;
                continue;
            }

            pushChild({
                type: "String",
                contents: currentToken.character
            });
            currentToken = lex.next().value;
            continue;
        }

        if (currentToken.type === 'EnclosedTextIndicator') {
            if (currentToken.enclosure === enclosedEnd) {
                if (ignoreEnclosureEndCountCurrent > 0) {
                    ignoreEnclosureEndCountCurrent--;
                    pushChild({
                        type: "String",
                        contents: currentToken.enclosure
                    });
                    currentToken = lex.next().value;
                    continue;
                } else {
                    lex.next();
                    break;
                }
            }
            if (currentToken.enclosure === ignoreEnclosureStart) {
                ignoreEnclosureEndCountCurrent++;
                pushChild({
                    type: "String",
                    contents: currentToken.enclosure
                });
                currentToken = lex.next().value;
                continue;
            }
            pushChild(parseEnclosedTextNode(lex, currentToken, true));
            currentToken = lex.current().value;
            continue;
        }

        if (currentToken.type === 'Whitespace') {
            pushChild({
                type: "String",
                contents: currentToken.text
            });
            currentToken = lex.next().value;
            continue;
        }

        if (currentToken.type === 'Variable') {
            pushChild(parseExpression(lex, currentToken));
            currentToken = lex.current().value;
            continue;
        }

        if (currentToken.type === 'NewLine') {
            currentToken = lex.next().value;
            pushChild({
                type: "String",
                contents: '\n'
            });
            continue;
        }
    }

    return children;
}

function parseTextNode(lex: Lexer, firstToken: Token): TextNode {
    if (firstToken.type === 'Word' || firstToken.type === 'SpecialCharacter' || firstToken.type === 'Variable') {
        return {
            type: "Text",
            contents: parseTextNodeChildren(lex, firstToken)
        }
    }

    if (firstToken.type === 'NewLine') {
        return {
            type: "Text",
            contents: []
        }
    }

    if (firstToken.type === 'EnclosedTextIndicator') {
        return {
            type: "Text",
            contents: [parseEnclosedTextNode(lex, firstToken)]
        }
    }

    if (firstToken.type === 'ScriptEnd') {
        return {
            type: "Text",
            contents: []
        }
    }

    throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);
}

function parseDialogue(lex: Lexer, firstToken: Token): DialogueNode {
    if (firstToken.type !== "Word" && firstToken.type !== 'Variable')
        throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);

    const {value: peaked, done: noPeak} = lex.peek();

    const speaker = !noPeak && firstToken.type !== 'Variable' && peaked.type === 'SpecialCharacter' && peaked.character === ':' ? firstToken.text : undefined;

    if (speaker) {
        lex.next();
    }

    const token = speaker ? skipWhitespace(lex) : firstToken;

    return {
        type: "Dialogue",
        contents: parseTextNode(lex, token),
        speaker
    }
}

export function parsePossibleAssignment(lex: Lexer, firstToken: Token): AssignmentNode | DialogueNode | AssignmentSelectNode {
    if (firstToken.type !== 'Variable')
        throw new ParseError(`Unexpected token ${firstToken.type}`, firstToken.range);

    lex.pushCurrent();
    const nextToken = skipWhitespace(lex, true);
    if (nextToken.type !== 'SpecialCharacter' || (nextToken.character !== '?' && nextToken.character !== '<' && nextToken.character !== '=')) {
        lex.popCurrent();
        return parseDialogue(lex, firstToken);
    } else {
        lex.shiftLast();
    }

    const key = firstToken.name;

    lex.next();

    if (nextToken.character === '?') {
        // Assignment select

        const options: AssignmentChoiceNode[] = [];

        while (!lex.isEOF()) {
            // find all the options
            const current = skipWhitespace(lex, true);
            if (current.type !== 'Word')
                throw new ParseError(`Unexpected token ${current.type}`, current.range);
            
            if (current.text !== 'if') {
                const optionName = current.text;
                lex.next();
                const next = skipWhitespace(lex, true);
                if (next.type !== 'EnclosedTextIndicator' || !(next.enclosure === '\'' || next.enclosure === '"'))
                    throw new ParseError(`Unexpected token ${next.type}`, next.range);
                const prompt = parseEnclosedTextNode(lex, next);
                if (prompt.type !== 'Text')
                    throw new ParseError(`Unexpected node ${prompt.type}`, next.range);
                options.push({
                    type: "AssignmentChoice",
                    value: {
                        type: "ChoiceValue",
                        key: optionName,
                        prompt: prompt,
                    }
                });
            } else {
                throw new Error('Unimplemented');
            }


            // now we need to check if there is a next option
            const nextLine = skipWhitespace(lex);
            if (nextLine && nextLine.type === 'SpecialCharacter' && nextLine.character === '?') {
                continue;
            } else {
                break;
            }
        }

        return {
            type: "AssignmentSelect",
            key,
            options
        }
    }

    const value = parseTextNode(lex, skipWhitespace(lex));

    return {
        type: "Assignment",
        key,
        value,
        isPrompt: nextToken.character === '<'
    }
}

export function parse(lex: Lexer): DocumentNode {
    const documentContents: (DialogueNode | AssignmentNode | AssignmentSelectNode)[] = [];

    while (!lex.isEOF()) {
        console.log('parse loop', lex.current());
        const token = skipWhitespace(lex, true);
        console.log('parseDialogue token', token)
        if (token.type === "ScriptEnd")
            break;
        if (token.type === 'Variable') {
            console.log('parsePossibleAssignment', token);
            documentContents.push(parsePossibleAssignment(lex, token));
            console.log('did parse', documentContents[documentContents.length - 1])
            continue;
        }
        documentContents.push(parseDialogue(lex, token));
        console.log('parsed dialogue', documentContents[documentContents.length - 1]);
    }

    return {
        type: "Document",
        contents: documentContents
    }
}
