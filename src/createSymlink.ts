console.log("Creating symlink...");

Deno.symlinkSync(Deno.realPathSync(`pack`), `pack-symlink`);

console.log("Complete! You can now move the symlink to your datapacks folder.");