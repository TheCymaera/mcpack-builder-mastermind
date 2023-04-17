import { Datapack, Duration, Namespace, NamespacedID, command, execute } from "npm:mcpack-builder@alpha";


import { Vector3 } from "npm:open-utilities@1/core/maths/Vector3.js";
import { emptyFolder, writeFiles } from "./fileUtilities.ts";

// output
const outputPath = "pack";
const datapack = new Datapack;

// config
const namespace = new Namespace("mastermind");
datapack.internalNamespace = namespace.id("internal");

const codeLength = 4;

const answerLocation = new Vector3(4, 54, -5);
const answerStride = new Vector3(-1, 0, 0);

const guessStride = new Vector3(0,0,-1);
const resultStride = new Vector3(1,1,0); // relative to guess

const resultIntervalTicks = 5;

const blockPalette = {
	// some blocks have states, so they need to be replaced with a stateless block before checking
	"minecraft:brown_mushroom_block": "minecraft:brown_concrete",
	"minecraft:red_mushroom_block": "minecraft:red_concrete",
	"minecraft:mushroom_stem": "minecraft:white_concrete",
	"minecraft:pumpkin": undefined,
	"minecraft:melon": undefined,
	"minecraft:flowering_azalea_leaves": "minecraft:green_concrete",
	"minecraft:dried_kelp_block": undefined,
}

const resultPalette = {
	correct: "minecraft:red_glazed_terracotta",
	wrongPosition: "minecraft:yellow_glazed_terracotta",
	incorrect: "minecraft:black_glazed_terracotta",
}

const usedPalette = {
	used: "minecraft:stone",
	unused: "minecraft:barrier",
}

datapack.packMeta = {
	pack: {
		pack_format: 14,
		description: "Mastermind",
	},
};

datapack.staticFiles.set(`data/${namespace.namespace}/tags/blocks/palette_or_air.json`, JSON.stringify({
	values: [...Object.keys(blockPalette).map(id => id.toString()), "minecraft:air"],
}));

datapack.mcfunction(namespace.id("randomize_code")).set(function * () {
	const finalBlock = answerLocation.clone().add(answerStride.clone().multiply(codeLength - 1));
	yield command`fill ${answerLocation.x} ${answerLocation.y} ${answerLocation.z} ${finalBlock.x} ${finalBlock.y} ${finalBlock.z} air`;

	for (let i = 0; i < codeLength; i++) {
		const blockLocation = answerLocation.clone().add(answerStride.clone().multiply(i));

		// summon a falling sand for each block type,
		// kill all but one
		yield datapack.internalMcfunction("summon_block").set(function * () {
			for (const block of Object.keys(blockPalette)) {
				yield command`summon minecraft:falling_block ${blockLocation.x} ${blockLocation.y} ${blockLocation.z} {NoGravity: 1b, BlockState:{Name:"${block}"}, Motion: [0.0d,0.0d,0.0d], Time: 100}`;
			}
	
			yield command`kill @e[type=minecraft:falling_block,limit=${Object.keys(blockPalette).length - 1},sort=random]`;

			// remove no gravity
			yield command`data modify entity @e[type=minecraft:falling_block,limit=1] NoGravity set value 0b`;
		}).scheduleAppend(Duration.ticks(5 * i + 1));
	}
});

datapack.mcfunction(namespace.id("summon_blocks"))
.set(function * () {
	for (const block of Object.keys(blockPalette)) {
		yield command`summon minecraft:item ~ ~ ~ {Item:{id:"${block}",Count:1}}`;
	}
});

const displayCorrect = datapack.internalMcfunction("display_correct")
.set(function * () {
	yield command`setblock ~ ~ ~ minecraft:poppy`;
	yield command`execute at @a run playsound minecraft:block.note_block.xylophone block @a ~ ~ ~ 1 2`;
	yield command`particle minecraft:dust 255 0 0 1 ~ ~ ~ 0 0 0 0 1 force`;
});

const displayWrongPosition = datapack.internalMcfunction("display_wrong_position")
.set(function * () {
	yield command`setblock ~ ~ ~ minecraft:dandelion`;
	yield command`execute at @a run playsound minecraft:block.note_block.xylophone block @a ~ ~ ~ 1 0`;
	yield command`particle minecraft:dust 255 255 0 1 ~ ~ ~ 0 0 0 0 1 force`;
});

const displayIncorrect = datapack.internalMcfunction("display_incorrect")
.set(function * () {
	yield command`setblock ~ ~ ~ minecraft:dead_bush`;
	yield command`execute at @a run playsound minecraft:block.note_block.basedrum block @a ~ ~ ~ 0.3 0`;
	yield command`particle minecraft:dust 0 0 0 1 ~ ~ ~ 0 0 0 0 1 force`;
});

const renderResults = datapack.internalMcfunction("render_results")
.set(function * () {
	const finalGuessBlock = guessStride.clone().multiply(codeLength - 1);

	// this row keeps track of which blocks have been matched to the answer
	yield command`fill ~ ~-2 ~ ~${finalGuessBlock.x} ~-2 ~${finalGuessBlock.z} ${usedPalette.unused}`;
	
	// this row stores the result
	yield command`fill ~ ~-3 ~ ~${finalGuessBlock.x} ~-3 ~${finalGuessBlock.z} ${resultPalette.incorrect}`;

	for (let i = 0; i < codeLength; i++) {
		const guessBlock = guessStride.clone().multiply(i);
		const answerBlock = answerLocation.clone().add(answerStride.clone().multiply(i));
		
		// this row stores the guess
		yield command`clone ~${guessBlock.x} ~ ~${guessBlock.z} ~${guessBlock.x} ~ ~${guessBlock.z} ~${guessBlock.x} ~-4 ~${guessBlock.z} replace`;

		// this row stores the answer
		yield command`clone ${answerBlock.x} ${answerBlock.y} ${answerBlock.z} ${answerBlock.x} ${answerBlock.y} ${answerBlock.z} ~${guessBlock.x} ~-5 ~${guessBlock.z} replace`;
	}

	// replace stateful blocks with stateless blocks
	for (const [block, statelessBlock] of Object.entries(blockPalette)) {
		if (statelessBlock === undefined) continue;
		yield command`fill ~ ~-4 ~ ~${finalGuessBlock.x} ~-5 ~${finalGuessBlock.z} ${statelessBlock} replace ${block}`;
	}


	// perfect match
	const foundCorrect = datapack.internalMcfunction("correct")
	.set(function * () {
		yield command`setblock ~ ~-2 ~ ${usedPalette.used}`;
		yield command`setblock ~ ~-3 ~ ${resultPalette.correct}`;
	});

	for (let i = 0; i < codeLength; i++) {
		yield execute`
			positioned ~${guessStride.x * i} ~ ~${guessStride.z * i} 
			if blocks ~ ~-4 ~ ~ ~-4 ~ ~ ~-5 ~ all
		`.run(foundCorrect.run())
	}

	// wrong position
	for (let guess = 0; guess < codeLength; guess++) {
		for (let answer = 0; answer < codeLength; answer++) {
			const guessBlock = guessStride.clone().multiply(guess);
			const answerBlock = guessStride.clone().multiply(answer);

			// ignore items that already have a result
			// ignore items that have been "used"
		
			yield execute`
				if block ~${guessBlock.x} ~-3 ~${guessBlock.z} ${resultPalette.incorrect} 
				if block ~${answerBlock.x} ~-2 ~${answerBlock.z} ${usedPalette.unused} 
				if blocks 
					~${guessBlock.x} ~-4 ~${guessBlock.z} 
					~${guessBlock.x} ~-4 ~${guessBlock.z} 
					~${answerBlock.x} ~-5 ~${answerBlock.z} all
			`.run(
				datapack.internalMcfunction("wrong_position")
				.set(function * () {
					// mark this block as "wrong position"
					yield command`setblock ~${guessBlock.x} ~-3 ~${guessBlock.z} ${resultPalette.wrongPosition}`;

					// mark this block as "used"
					yield command`setblock ~${answerBlock.x} ~-2 ~${answerBlock.z} ${usedPalette.used}`;
				}).run()
			);
		}
	}

	// animate result
	const displayResult = datapack.internalMcfunction("display_result").set(function * () {
		yield execute`if block ~ ~-3 ~ ${resultPalette.correct} positioned ~${resultStride.x} ~${resultStride.y} ~${resultStride.z}`.run(displayCorrect.run());
		yield execute`if block ~ ~-3 ~ ${resultPalette.wrongPosition} positioned ~${resultStride.x} ~${resultStride.y} ~${resultStride.z}`.run(displayWrongPosition.run());
		yield execute`if block ~ ~-3 ~ ${resultPalette.incorrect} positioned ~${resultStride.x} ~${resultStride.y} ~${resultStride.z}`.run(displayIncorrect.run());
	});
	for (let i = 0; i < codeLength; i++) {
		const interval = Duration.ticks(resultIntervalTicks * i + 1);

		// calling a function via schedule will not preserve its context, so we need to position it relative to the marker
		yield datapack.internalMcfunction(`display_result_${i}`).set(function * () {
			yield execute`at @e[tag=mastermind_marker] positioned ~${guessStride.x * i} ~ ~${guessStride.z * i}`.run(displayResult.run());
		}).scheduleAppend(interval);
	}
});


	
const removeMarker = datapack.internalMcfunction("remove_marker").set(function * () {
	yield command`kill @e[tag=mastermind_marker]`;
});


function submitAnswer(id: NamespacedID, final: boolean) {
	datapack.mcfunction(id).set(function * () {
		yield command`summon minecraft:marker ~ ~ ~ {Tags:["mastermind_marker"]}`;

		yield renderResults.run();
		
		const finalInterval = Duration.ticks(resultIntervalTicks * codeLength + 1);

		const conditions: string[] = [];
		for (let i = 0; i < codeLength; i++) {
			const position = guessStride.clone().multiply(i);
			conditions.push(`if block ~${position.x} ~-3 ~${position.z} ${resultPalette.correct}`);
		}

		yield command`title @a times 0 20 0`;
		if (final) yield command`title @a title {"text":"You Lose!", "color": "red"}`
		yield execute`${conditions.join(" ")}`.run(
			datapack.internalMcfunction("on_win").set(function * () {
				yield command`title @a title {"text":"You Win!"}`;
				yield command`tag @a add mastermind_win`;
			}).run()
		);

		yield removeMarker.scheduleReplace(finalInterval);
	});
}

submitAnswer(namespace.id("submit_answer"), false);
submitAnswer(namespace.id("submit_answer_final"), true);


console.log("Writing files...");
await emptyFolder(outputPath);
await writeFiles(outputPath, datapack.build().files);
console.log("Complete!");