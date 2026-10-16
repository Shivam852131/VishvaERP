const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema({
  collegeId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', required: true },
  name: { type: String, required: true },
  category: { type: String, enum: ['lab-equipment', 'furniture', 'it-hardware', 'stationery', 'library', 'sports', 'medical', 'other'], required: true },
  itemId: { type: String, unique: true },
  description: { type: String },
  quantity: { type: Number, default: 0 },
  unit: { type: String, default: 'pcs' },
  location: { type: String },
  department: { type: String },
  condition: { type: String, enum: ['new', 'good', 'fair', 'poor', 'damaged'], default: 'new' },
  purchaseDate: { type: Date },
  purchasePrice: { type: Number },
  currentValue: { type: Number },
  vendor: { type: String },
  warrantyExpiry: { type: Date },
  lastMaintenance: { type: Date },
  nextMaintenance: { type: Date },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['available', 'in-use', 'maintenance', 'retired', 'lost'], default: 'available' },
  assets: [{
    serialNumber: { type: String },
    status: { type: String, enum: ['available', 'assigned', 'maintenance', 'retired', 'lost'], default: 'available' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedAt: { type: Date },
  }],
  maintenanceLogs: [{
    type: { type: String, enum: ['repair', 'service', 'upgrade', 'inspection'] },
    description: { type: String },
    cost: { type: Number },
    performedBy: { type: String },
    date: { type: Date, default: Date.now },
  }],
  attachments: [{ type: String }],
}, { timestamps: true });

inventoryItemSchema.index({ collegeId: 1, category: 1 });
inventoryItemSchema.index({ collegeId: 1, status: 1 });
inventoryItemSchema.index({ collegeId: 1, itemId: 1 });

inventoryItemSchema.pre('save', function (next) {
  if (!this.itemId) {
    this.itemId = `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  }
  next();
});

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
