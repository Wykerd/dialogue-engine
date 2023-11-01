import { createVM, run } from "../src/vm.ts";


const vm = createVM(Deno.readFileSync('script.bc').buffer);

let done = false;

while (!done) {
    done = run(vm);
}

console.log(vm.toJSON());
