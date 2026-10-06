import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPetService } from "../src/pets/petService.js";

/** 生成最小合法 1536×1872 WebP（VP8X 头，只够尺寸解析）。 */
function makeWebp1536x1872(): Buffer {
  const buffer = Buffer.alloc(64);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(52, 4); // 文件总长占位
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16); // VP8X chunk 长度
  // 宽 = 1536 - 1，24 位小端，偏移 24；高 = 1872 - 1，偏移 27。
  buffer.writeUIntLE(1536 - 1, 24, 3);
  buffer.writeUIntLE(1872 - 1, 27, 3);
  return buffer;
}

/** 生成最小合法 1536×1872 PNG（签名 + IHDR 宽高字段）。 */
function makePng1536x1872(): Buffer {
  const buffer = Buffer.alloc(64);
  buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  buffer.writeUInt32BE(13, 8); // IHDR 长度
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(1536, 16);
  buffer.writeUInt32BE(1872, 20);
  return buffer;
}

async function makePetsRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "nex-pets-test-"));
}

test("listPets: 目录不存在时返回空列表而非错误", async () => {
  const service = createPetService({ petsRootDir: join(tmpdir(), "nex-pets-nonexistent") });
  const result = await service.listPets();
  assert.deepEqual(result, { pets: [], errors: [] });
});

test("listPets: 合法 WebP 宠物被识别", async () => {
  const root = await makePetsRoot();
  try {
    const dir = join(root, "tater");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pet.json"), JSON.stringify({ id: "tater", displayName: "Tater" }));
    await writeFile(join(dir, "spritesheet.webp"), makeWebp1536x1872());

    const service = createPetService({ petsRootDir: root });
    const result = await service.listPets();
    assert.equal(result.errors.length, 0);
    assert.equal(result.pets.length, 1);
    assert.equal(result.pets[0]?.id, "tater");
    assert.equal(result.pets[0]?.displayName, "Tater");
    assert.equal(result.pets[0]?.spritesheetFileName, "spritesheet.webp");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listPets: 合法 PNG 宠物被识别", async () => {
  const root = await makePetsRoot();
  try {
    const dir = join(root, "cat");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "pet.json"),
      JSON.stringify({ id: "cat", spritesheetPath: "spritesheet.png" }),
    );
    await writeFile(join(dir, "spritesheet.png"), makePng1536x1872());

    const service = createPetService({ petsRootDir: root });
    const result = await service.listPets();
    assert.equal(result.errors.length, 0);
    assert.equal(result.pets.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listPets: 缺 pet.json 的目录进 errors，不阻塞其他宠物", async () => {
  const root = await makePetsRoot();
  try {
    const badDir = join(root, "broken");
    await mkdir(badDir, { recursive: true });
    await writeFile(join(badDir, "spritesheet.webp"), makeWebp1536x1872());

    const goodDir = join(root, "good");
    await mkdir(goodDir, { recursive: true });
    await writeFile(join(goodDir, "pet.json"), JSON.stringify({ id: "good" }));
    await writeFile(join(goodDir, "spritesheet.webp"), makeWebp1536x1872());

    const service = createPetService({ petsRootDir: root });
    const result = await service.listPets();
    assert.equal(result.pets.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0]?.dirName, "broken");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listPets: spritesheetPath 越界（绝对路径/..）被拒绝", async () => {
  const root = await makePetsRoot();
  try {
    const dir = join(root, "evil");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "pet.json"),
      JSON.stringify({ id: "evil", spritesheetPath: "../../etc/passwd" }),
    );

    const service = createPetService({ petsRootDir: root });
    const result = await service.listPets();
    assert.equal(result.pets.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]?.reason ?? "", /相对路径/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listPets: 社区扩展行高变体（1536×2288，11 行）被接受", async () => {
  const root = await makePetsRoot();
  try {
    const dir = join(root, "bubu");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pet.json"), JSON.stringify({ id: "bubu" }));
    // 1536×2288：宽度匹配、高度为 208 的 11 倍（社区加行扩展）。
    const buffer = Buffer.alloc(64);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
    buffer.write("VP8X", 12, "ascii");
    buffer.writeUIntLE(1536 - 1, 24, 3);
    buffer.writeUIntLE(2288 - 1, 27, 3);
    await writeFile(join(dir, "spritesheet.webp"), buffer);

    const service = createPetService({ petsRootDir: root });
    const result = await service.listPets();
    assert.equal(result.errors.length, 0);
    assert.equal(result.pets.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listPets: 精灵图尺寸不满足网格铺满进 errors", async () => {
  const root = await makePetsRoot();
  try {
    const dir = join(root, "wrongsize");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "pet.json"), JSON.stringify({ id: "wrongsize" }));
    // 写一张尺寸不符的 WebP（512×512）。
    const buffer = Buffer.alloc(64);
    buffer.write("RIFF", 0, "ascii");
    buffer.write("WEBP", 8, "ascii");
    buffer.write("VP8X", 12, "ascii");
    buffer.writeUIntLE(512 - 1, 24, 3);
    buffer.writeUIntLE(512 - 1, 27, 3);
    await writeFile(join(dir, "spritesheet.webp"), buffer);

    const service = createPetService({ petsRootDir: root });
    const result = await service.listPets();
    assert.equal(result.pets.length, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0]?.reason ?? "", /未铺满/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("getPetSpritesheetPath: 宠物不存在返回 null", async () => {
  const root = await makePetsRoot();
  try {
    const service = createPetService({ petsRootDir: root });
    assert.equal(await service.getPetSpritesheetPath({ petId: "nope" }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
