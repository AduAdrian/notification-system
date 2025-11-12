import swaggerJsdoc from 'swagger-jsdoc';
import { Options } from 'swagger-jsdoc';
import path from 'path';
import fs from 'fs';
import YAML from 'yamljs';

// Load the OpenAPI YAML file
const openApiPath = path.join(__dirname, '../../openapi.yaml');
const openApiSpec = YAML.load(openApiPath);

// Swagger JSDoc options for adding JSDoc annotations
const swaggerOptions: Options = {
  definition: openApiSpec,
  apis: [
    path.join(__dirname, '../routes/*.ts'),
    path.join(__dirname, '../controllers/*.ts'),
  ],
};

// Generate the Swagger specification
export const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Swagger UI options
export const swaggerUiOptions = {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Notification Service API Documentation',
  customfavIcon: '/favicon.ico',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    syntaxHighlight: {
      activate: true,
      theme: 'monokai',
    },
    tryItOutEnabled: true,
  },
};
