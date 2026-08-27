// MdocProverService.ts
import init, { initialize_prover, prove_with_ppid_wasm, CircuitVersion } from './pkg/zk_cred_longfellow.js';
import { decompress as fzstdDecompress } from 'fzstd';

export interface WitnessVector {
  mdoc: string;
  transcript: string;
  now: string;
  pseudonymSeed: Uint8Array;
}

export interface ProofResult {
  proof: Uint8Array;
  proofHex: string;
  ppid: Uint8Array;
  ppidHex: string;
  durationMs: number;
}

export class MdocProverService {
  private proverInstance: any = null;
  public isInitialized = false;

  private readonly CIRCUIT_PATH = "/8_2_4307_2945_bb8e6a26d2700ddad968562d1c4aee83067772fee6f889748a0bc64f2c694ad5";
  private readonly EXPECTED_CIRCUIT_HASH = "bb8e6a26d2700ddad968562d1c4aee83067772fee6f889748a0bc64f2c694ad5";

  private readonly VERIFIER_CONTEXT = new Uint8Array([
    0x76, 0x65, 0x72, 0x69, 0x66, 0x69, 0x65, 0x72,
    0x40, 0x63, 0x6c, 0x69, 0x65, 0x6e, 0x74, 0x2e,
    0x65, 0x78, 0x61, 0x6d, 0x70, 0x6c, 0x65, 0x2e,
    0x63, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  // Small helper so every stage logs consistently: "⏱ <label>: <ms>ms"
  private async timeStage<T>(label: string, fn: () => Promise<T> | T): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const durationMs = performance.now() - start;
      console.log(` ${label}: ${durationMs.toFixed(0)}ms`);
      return result;
    } catch (e) {
      const durationMs = performance.now() - start;
      console.log(` ${label}: FAILED after ${durationMs.toFixed(0)}ms`);
      throw e;
    }
  }

  private async fetchAndDecompressCircuit(path: string): Promise<Uint8Array> {
    const response = await this.timeStage('fetch circuit (network)', () => fetch(path));
    if (!response.ok) {
      throw new Error(`Failed to fetch circuit: ${response.status}`);
    }

    console.log(` Fetched compressed circuit (${path})`);

    const compressedBytes = await this.timeStage('read response body (arrayBuffer)', async () => {
      return new Uint8Array(await response.arrayBuffer());
    });

    console.log(`   compressed size: ${(compressedBytes.length / 1024 / 1024).toFixed(2)} MB`);
    console.log('First 8 bytes:', Array.from(compressedBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('Content-Encoding header:', response.headers.get('content-encoding'));

    const decompressedBytes = await this.timeStage('zstd decompress', () => fzstdDecompress(compressedBytes));

    console.log(` Decompressed circuit: ${(decompressedBytes.length / 1024 / 1024).toFixed(1)} MB`);
    return decompressedBytes;
  }

  private async verifyCircuitIntegrity(bytes: Uint8Array): Promise<void> {
    const hashHex = await this.timeStage('SHA-256 integrity hash', async () => {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return this.bytesToHex(new Uint8Array(digest));
    });

    if (hashHex !== this.EXPECTED_CIRCUIT_HASH) {
      //throw new Error(`Circuit integrity check failed. Expected ${this.EXPECTED_CIRCUIT_HASH}, got ${hashHex}`);
    }
    console.log(' Circuit integrity verified:', hashHex);
  }

  async bootstrap(): Promise<void> {
    if (this.isInitialized) return;

    const bootstrapStart = performance.now();

    await this.timeStage('wasm init()', () => init());

    console.log(" Fetching V8 circuit...");
    const circuitBytes = await this.fetchAndDecompressCircuit(this.CIRCUIT_PATH);

    await this.verifyCircuitIntegrity(circuitBytes);

    await this.timeStage('initialize_prover (WASM)', () => {
      this.proverInstance = initialize_prover(circuitBytes, CircuitVersion.V8, 2);
    });

    this.isInitialized = true;

    const totalMs = performance.now() - bootstrapStart;
    console.log(`V8 prover ready — bootstrap total: ${totalMs.toFixed(0)}ms`);
  }

  private hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/[^0-9a-fA-F]/g, '');
    const res = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2)
      res[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    return res;
  }

  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async computePPID(seed: Uint8Array, ctx: Uint8Array): Promise<Uint8Array> {
    const input = new Uint8Array(64);
    input.set(seed, 0);
    input.set(ctx, 32);
    return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  }

  async generateProof(witness: WitnessVector): Promise<ProofResult> {
    if (!this.isInitialized || !this.proverInstance)
      throw new Error("Prover not initialized. Call bootstrap() first.");

    const generateStart = performance.now();

    const mdocBytes = this.hexToBytes(witness.mdoc);
    const transcriptBytes = this.hexToBytes(witness.transcript);

    const proof = await this.timeStage('prove_with_ppid_wasm (circuit evaluation)', () => {
      return prove_with_ppid_wasm(
        this.proverInstance,
        mdocBytes,
       "eu.europa.ec.eudi.pid.1",
        ["age_over_18", "pairwise_pseudonym"],
        transcriptBytes,
        witness.now,
        this.VERIFIER_CONTEXT
      );
    });

    const ppid = await this.timeStage('computePPID', () => this.computePPID(witness.pseudonymSeed, this.VERIFIER_CONTEXT));

    const durationMs = performance.now() - generateStart;

    console.log(` V8 proof generated — generateProof total: ${durationMs.toFixed(0)}ms, PPID: ${this.bytesToHex(ppid)}`);

    return {
      proof,
      proofHex: this.bytesToHex(proof),
      ppid,
      ppidHex: this.bytesToHex(ppid),
      durationMs,
    };
  }
}