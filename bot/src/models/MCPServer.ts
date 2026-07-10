import { Schema, model, Document } from 'mongoose';

export interface IPersonalField {
  name: string;
  label: string;
  description: string;
  isSecret: boolean;
  placeholder: string;
  defaultValue: string;
}

export interface IMCPServer extends Document {
  name: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  isEnabled: boolean;
  isDefault: boolean;
  description: string;
  tools: string[];
  toolDescriptions: Record<string, string>;
  transportType: 'stdio' | 'streamable-http' | 'sse';
  remoteUrl: string;
  remoteHeaders: Record<string, string>;
  personalFields: IPersonalField[];
  sourcePath: string;
  lastConnectedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const personalFieldSchema = new Schema<IPersonalField>({
  name: { type: String, required: true },
  label: { type: String, default: '' },
  description: { type: String, default: '' },
  isSecret: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  defaultValue: { type: String, default: '' },
}, { _id: false });

const mcpServerSchema = new Schema<IMCPServer>({
  name: { type: String, required: true, unique: true },
  displayName: { type: String, default: '' },
  command: { type: String, default: '' },
  args: { type: [String], default: [] },
  env: { type: Map, of: String, default: {} },
  isEnabled: { type: Boolean, default: true },
  isDefault: { type: Boolean, default: false },
  description: { type: String, default: '' },
  tools: { type: [String], default: [] },
  toolDescriptions: { type: Map, of: String, default: {} },
  transportType: { type: String, enum: ['stdio', 'streamable-http', 'sse'], default: 'stdio' },
  remoteUrl: { type: String, default: '' },
  remoteHeaders: { type: Map, of: String, default: {} },
  personalFields: [personalFieldSchema],
  sourcePath: { type: String, default: '' },
  lastConnectedAt: Date,
  lastError: String,
}, { timestamps: true });

export const MCPServer = model<IMCPServer>('MCPServer', mcpServerSchema);
