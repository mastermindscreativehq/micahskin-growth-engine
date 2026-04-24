'use strict'

/**
 * Template for store-specific product adapters.
 * Copy this file, rename it, and fill in the fetch() logic.
 *
 * Required fields each product object must include:
 *   productName         string
 *   brand               string
 *   category            string
 *   concernsSupported   string[]  e.g. ['acne', 'hyperpigmentation']
 *   skinTypesSupported  string[]  e.g. ['oily', 'combination']
 *   price               number
 *   currency            string    default 'NGN'
 *   purchaseUrl         string
 *
 * Optional fields:
 *   subcategory, description, keyIngredients, contraindications,
 *   routineStep, sensitivityFriendly, imageUrl, stockStatus,
 *   availabilityStatus, confidenceScore, country, market, sourceType
 */

// const axios = require('axios')

const STORE_ADAPTER = {
  name:        'store_name_here',
  sourceStore: 'store_name_here',

  async fetch() {
    // 1. Fetch raw product data from this store
    // const response = await axios.get('https://store.example.com/api/products')
    // const rawProducts = response.data.products
    const rawProducts = []

    // 2. Map raw data to the normalized structure
    return rawProducts.map(raw => ({
      productName:        raw.name || raw.title,
      brand:              raw.brand || raw.vendor,
      category:           raw.product_type || raw.category,
      concernsSupported:  raw.tags
        ?.filter(t => t.startsWith('concern:'))
        .map(t => t.replace('concern:', '')) || [],
      skinTypesSupported: raw.tags
        ?.filter(t => t.startsWith('skin:'))
        .map(t => t.replace('skin:', '')) || [],
      price:              raw.variants?.[0]?.price ?? raw.price,
      currency:           'NGN',
      purchaseUrl:        `https://store.example.com/products/${raw.handle}`,
      imageUrl:           raw.images?.[0]?.src || null,
      description:        raw.body_html?.replace(/<[^>]+>/g, '').slice(0, 500) || null,
      keyIngredients:     [],
      country:            'NG',
      market:             'nigeria',
      stockStatus:        raw.available ? 'in_stock' : 'out_of_stock',
      confidenceScore:    0.7,
      sourceType:         'scraped',
      sourceStore:        'store_name_here',
    }))
  },
}

module.exports = STORE_ADAPTER
