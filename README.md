# SNS Service

A Node.js TypeScript service that integrates with Solana Name Service (SNS) using the @bonfida/spl-name-service SDK. This service supports USDC-based domain purchases with a system relayer as fee payer.

## Features

- ✅ Domain availability checking
- ✅ USDC-based domain purchases
- ✅ Domain ownership updates
- ✅ Domain lookups and reverse lookups
- ✅ System relayer for gas fee coverage
- ✅ Atomic transactions with multiple instructions
- ✅ TypeScript support
- ✅ Express.js REST API

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Solana wallet with SOL for gas fees
- USDC tokens for domain purchases

## Installation

1. Clone the repository and navigate to the project directory:
```bash
cd sns-service
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment template and configure your settings:
```bash
cp env.example .env
```

4. Edit `.env` with your configuration:
```env
# Solana RPC Endpoint
RPC_ENDPOINT=https://api.mainnet-beta.solana.com

# System Wallet (Base58 encoded private key)
SYSTEM_WALLET_PRIVATE_KEY=your_system_wallet_private_key_here

# USDC Mint Address (Mainnet)
USDC_MINT_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# SNS Program IDs
SNS_PROGRAM_ID=58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx
SNS_UPGRADE_AUTHORITY=5C1k9yV7ybiCj8KcNy1DVZRu7nJ8s7qk1vq8qJ8qJ8qJ

# Server Configuration
PORT=3000
```

## Running the Service

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

The service will start on `http://localhost:3000` (or the port specified in your `.env`).

## API Endpoints

### 1. Check Domain Availability
**GET** `/sns/check-domain`

Check if a domain is available and get its price.

**Query Parameters:**
- `name` (string, required): Domain name (e.g., "example.sol")

**Response:**
```json
{
  "domain": "example.sol",
  "available": true,
  "priceUSDC": 5.0,
  "message": "Domain is available"
}
```

**Example:**
```bash
curl "http://localhost:3000/sns/check-domain?name=example.sol"
```

### 2. Purchase Domain
**POST** `/sns/purchase-domain`

Create a transaction for purchasing a domain with USDC.

**Request Body:**
```json
{
  "name": "example.sol",
  "buyerPubkey": "BuyerWalletPublicKeyHere",
  "domainPriceUSDC": 5.0,
  "serviceFeeUSDC": 0.25,
  "serviceFeeAddress": "ServiceFeeWalletPublicKeyHere"
}
```

**Response:**
```json
{
  "success": true,
  "transaction": "base64_encoded_transaction",
  "message": "Transaction created successfully. User must sign and submit."
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/sns/purchase-domain \
  -H "Content-Type: application/json" \
  -d '{
    "name": "example.sol",
    "buyerPubkey": "BuyerWalletPublicKeyHere",
    "domainPriceUSDC": 5.0,
    "serviceFeeUSDC": 0.25,
    "serviceFeeAddress": "ServiceFeeWalletPublicKeyHere"
  }'
```

### 3. Update Domain Owner
**POST** `/sns/update-domain`

Update the owner of an existing domain.

**Request Body:**
```json
{
  "domain": "example.sol",
  "newOwner": "NewOwnerWalletPublicKeyHere"
}
```

**Response:**
```json
{
  "success": true,
  "transaction": "base64_encoded_transaction",
  "message": "Update transaction created successfully"
}
```

### 4. Domain Lookup
**GET** `/sns/lookup`

Get all domains owned by a specific public key.

**Query Parameters:**
- `pubkey` (string, required): Public key to lookup

**Response:**
```json
{
  "pubkey": "WalletPublicKeyHere",
  "domains": ["example.sol", "test.sol"],
  "message": "Domain lookup completed"
}
```

### 5. Reverse Lookup
**GET** `/sns/reverse-lookup`

Get the owner of a specific domain.

**Query Parameters:**
- `domain` (string, required): Domain name (e.g., "example.sol")

**Response:**
```json
{
  "domain": "example.sol",
  "owner": "OwnerWalletPublicKeyHere",
  "message": "Reverse lookup completed"
}
```

### 6. Health Check
**GET** `/health`

Check if the service is running.

**Response:**
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Domain Pricing

The service uses a simplified pricing model based on domain length:

- 3 characters or less: 10.0 USDC
- 4-5 characters: 5.0 USDC  
- 6-8 characters: 2.0 USDC
- 9+ characters: 1.0 USDC

## Transaction Flow

1. **Purchase Flow:**
   - User calls `/sns/purchase-domain` with domain details
   - Service creates a transaction with:
     - USDC transfer from buyer to SNS payment account
     - USDC transfer from buyer to service fee address
     - SNS domain registration instruction
   - System wallet signs the transaction (covers gas fees)
   - Returns base64-encoded transaction for user to sign and submit

2. **Update Flow:**
   - User calls `/sns/update-domain` with new owner details
   - Service creates update transaction
   - System wallet signs and returns transaction

## Error Handling

The service returns appropriate HTTP status codes:

- `200`: Success
- `400`: Bad Request (invalid input)
- `404`: Not Found (domain doesn't exist)
- `500`: Internal Server Error

Error responses include a descriptive message:
```json
{
  "error": "Domain name is required"
}
```

## Security Considerations

- Store system wallet private key securely
- Use environment variables for sensitive data
- Validate all input parameters
- Implement rate limiting in production
- Use HTTPS in production
- Consider implementing authentication/authorization

## Development

### Project Structure
```
sns-service/
├── src/
│   └── index.ts          # Main application file
├── dist/                 # Compiled JavaScript (generated)
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── env.example           # Environment variables template
└── README.md            # This file
```

### Available Scripts
- `npm run dev`: Start development server with hot reload
- `npm run build`: Compile TypeScript to JavaScript
- `npm start`: Start production server
- `npm test`: Run tests (placeholder)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License
