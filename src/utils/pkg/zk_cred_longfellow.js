/* @ts-self-types="./zk_cred_longfellow.d.ts" */
import { MdocZkError } from './snippets/zk-cred-longfellow-70b30f8599b4aa9b/js/error.js';

/**
 * Versions of the mdoc_zk circuit interface.
 * @enum {6 | 7 | 8}
 */
export const CircuitVersion = Object.freeze({
    V6: 6, "6": "V6",
    V7: 7, "7": "V7",
    V8: 8, "8": "V8",
});

/**
 * Zero-knowledge prover for mdoc credential presentations.
 */
export class MdocZkProver {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MdocZkProver.prototype);
        obj.__wbg_ptr = ptr;
        MdocZkProverFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MdocZkProverFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mdoczkprover_free(ptr, 0);
    }
}
if (Symbol.dispose) MdocZkProver.prototype[Symbol.dispose] = MdocZkProver.prototype.free;

/**
 * Zero-knowledge verifier for mdoc credential presentations.
 */
export class MdocZkVerifier {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(MdocZkVerifier.prototype);
        obj.__wbg_ptr = ptr;
        MdocZkVerifierFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        MdocZkVerifierFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_mdoczkverifier_free(ptr, 0);
    }
}
if (Symbol.dispose) MdocZkVerifier.prototype[Symbol.dispose] = MdocZkVerifier.prototype.free;

/**
 * Initialize the prover by loading a decompressed circuit file.
 *
 * @param {Uint8Array} circuit - The decompressed circuit file.
 * @param {CircuitVersion} circuit_version - The version of the mdoc_zk circuit interface.
 * @param {number} num_attributes - The number of attributes to be disclosed in the presentation.
 * @returns {MdocZkProver}
 */
export function initialize_prover(circuit, circuit_version, num_attributes) {
    const ptr0 = passArray8ToWasm0(circuit, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.initialize_prover(ptr0, len0, circuit_version, num_attributes);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return MdocZkProver.__wrap(ret[0]);
}

/**
 * Initialize a V8 verifier from a circuit binary.
 * @param {Uint8Array} circuit
 * @param {CircuitVersion} circuit_version
 * @param {number} num_attributes
 * @returns {MdocZkVerifier}
 */
export function initialize_verifier(circuit, circuit_version, num_attributes) {
    const ptr0 = passArray8ToWasm0(circuit, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.initialize_verifier(ptr0, len0, circuit_version, num_attributes);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return MdocZkVerifier.__wrap(ret[0]);
}

/**
 * Create a proof for a credential presentation.
 *
 * @param {MdocZkProver} prover - The prover returned from `initialize()`.
 * @param {Uint8Array} device_response - The mdoc's DeviceResponse, as CBOR data.
 * @param {string} namespace -  The namespace of the claims.
 * @param {string[]} requested_claims - The identifiers of the claims to be disclosed.
 * @param {Uint8Array} session_transcript - The `SessionTranscript`, as CBOR data.
 * @param {string} time - The current time. This must be in RFC 3339 format, in UTC, with no time zone offset.
 * @returns {Uint8Array} The serialized proof.
 */
export function prove(prover, device_response, namespace, requested_claims, session_transcript, time) {
    _assertClass(prover, MdocZkProver);
    const ptr0 = passArray8ToWasm0(device_response, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayJsValueToWasm0(requested_claims, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(session_transcript, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(time, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.prove(prover.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v6 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v6;
}

/**
 * Create a proof with PPID support (V8 circuits).
 *
 * @param {MdocZkProver} prover - The prover returned from `initialize_prover()`.
 * @param {Uint8Array} device_response - The mdoc's DeviceResponse, as CBOR data.
 * @param {string} namespace - The namespace of the attributes to be disclosed.
 * @param {string[]} requested_claims - The identifiers of the attributes to disclose.
 * @param {Uint8Array} session_transcript - The session transcript binding the presentation.
 * @param {string} time - The current time in RFC 3339 format (e.g. "2026-03-05T22:39:45Z").
 * @param {Uint8Array} verifier_context - 32-byte verifier context for PPID derivation.
 * @returns {Uint8Array} The serialized proof.
 * @param {MdocZkProver} prover
 * @param {Uint8Array} device_response
 * @param {string} namespace
 * @param {string[]} requested_claims
 * @param {Uint8Array} session_transcript
 * @param {string} time
 * @param {Uint8Array} verifier_context
 * @returns {Uint8Array}
 */
export function prove_with_ppid_wasm(prover, device_response, namespace, requested_claims, session_transcript, time, verifier_context) {
    _assertClass(prover, MdocZkProver);
    const ptr0 = passArray8ToWasm0(device_response, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayJsValueToWasm0(requested_claims, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(session_transcript, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(time, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArray8ToWasm0(verifier_context, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ret = wasm.prove_with_ppid_wasm(prover.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v7 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v7;
}

/**
 * Verify a V8 proof with PPID support.
 * @param {MdocZkVerifier} verifier
 * @param {Uint8Array} issuer_public_key_sec1
 * @param {Uint8Array} given_name_cbor
 * @param {Uint8Array} ppid_cbor
 * @param {string} namespace
 * @param {string} doc_type
 * @param {Uint8Array} session_transcript
 * @param {string} time
 * @param {Uint8Array} verifier_context
 * @param {Uint8Array} proof
 */
export function verify_with_ppid_wasm(verifier, issuer_public_key_sec1, given_name_cbor, ppid_cbor, namespace, doc_type, session_transcript, time, verifier_context, proof) {
    _assertClass(verifier, MdocZkVerifier);
    const ptr0 = passArray8ToWasm0(issuer_public_key_sec1, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(given_name_cbor, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(ppid_cbor, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(namespace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(doc_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArray8ToWasm0(session_transcript, wasm.__wbindgen_malloc);
    const len5 = WASM_VECTOR_LEN;
    const ptr6 = passStringToWasm0(time, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len6 = WASM_VECTOR_LEN;
    const ptr7 = passArray8ToWasm0(verifier_context, wasm.__wbindgen_malloc);
    const len7 = WASM_VECTOR_LEN;
    const ptr8 = passArray8ToWasm0(proof, wasm.__wbindgen_malloc);
    const len8 = WASM_VECTOR_LEN;
    const ret = wasm.verify_with_ppid_wasm(verifier.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5, ptr6, len6, ptr7, len7, ptr8, len8);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_string_get_72fb696202c56729: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_3c9c0d586e575a16: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_new_cbdd83e995386236: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                const ret = new MdocZkError(getStringFromWasm0(arg0, arg1));
                return ret;
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./zk_cred_longfellow_bg.js": import0,
    };
}

const MdocZkProverFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mdoczkprover_free(ptr >>> 0, 1));
const MdocZkVerifierFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_mdoczkverifier_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic':
            case 'cors':
            case 'default':
                return true;

            default:
                return false;
        }
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('zk_cred_longfellow_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
