import { compileBytecode, compileIR, createCompiler, dumpSymbolTable } from "../src/compiler.ts";
import { lex } from "../src/lexer.ts";
import { ParseError, parse } from "../src/parser.ts";

try {
    const ast = parse(lex(Deno.readTextFileSync('./script.txt')));
    Deno.writeTextFileSync('./script.ast.json', JSON.stringify(ast, undefined, 4));
    const state = createCompiler();
    const ir = compileIR(ast, state);
    Deno.writeTextFileSync('./script.ir.json', JSON.stringify(ir, undefined, 4)); 
    Deno.writeTextFileSync('./script.sym.json', JSON.stringify(dumpSymbolTable(state), undefined, 4));
    const bytecode = compileBytecode(ir, state);
    Deno.writeFileSync('./script.bc', new Uint8Array(bytecode));
} catch (error) {
    if (error instanceof ParseError) {
        console.error(error.toString(), error.stack);
    } else {
        throw error;
    }
}