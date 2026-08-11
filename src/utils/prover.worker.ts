// prover.worker.ts
import { MdocProverService } from './MdocProverService';

const proverService = new MdocProverService();

globalThis.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'GENERATE_PROOF') {
    try {

      if (!proverService.isInitialized) {
        await proverService.bootstrap();
      }

      // payload: { mdoc: string, transcript: string, now: string }
      const result = await proverService.generateProof(payload);

      // result: { proof, proofHex, ppid, ppidHex, durationMs }
      globalThis.postMessage(
        { type: 'PROOF_SUCCESS', payload: result },
        [result.proof.buffer, result.ppid.buffer]
      );
    } catch (error: any) {
      globalThis.postMessage({ type: 'PROOF_ERROR', payload: error.message });
    }
  }
};