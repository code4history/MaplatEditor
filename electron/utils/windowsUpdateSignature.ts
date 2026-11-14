import type { VerifyUpdateCodeSignature } from 'electron-updater'
import { verifyWindowsUpdateSignature as verify } from './windowsUpdateSignatureRuntime.mjs'

// The Windows installer check executes this same dependency-free implementation.
export const verifyWindowsUpdateSignature: VerifyUpdateCodeSignature = verify
