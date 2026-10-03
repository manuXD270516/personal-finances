// Regla `pf/no-number-money` (TC-PLATFORM-ARCH-002, ADR-0006, INV-001). Promovida desde
// spikes/SPIKE-03-money/lint como capa SINTÁCTICA (sin información de tipos): no exige typed linting en todo el
// monorepo. La segunda barrera la dan `Money` (rechaza `number` al compilar y en ejecución) y Spectral en contratos.
//
// Reporta:
//   * propiedades, campos de clase, parámetros y variables con nombre monetario anotados con `number`
//     (también en uniones `number | string`);
//   * `parseFloat(x)`, `Number(x)`, `Number.parseFloat(x)` y `+x` sobre un valor con nombre monetario;
//   * literales numéricos pasados a las fábricas de `Money` (`Money.of(10.5, …)`);
//   * `x.toFixed(n)` (Number#toFixed) y `x.toNumber()` sobre un valor con nombre monetario.

/** Nombres monetarios: exactos o con sufijo en camelCase (`feeAmount`, `totalBalance`, `exchangeRate`…). */
export const MONEY_NAME =
  /^(amount|balance|price|fee|total|rate|subtotal|principal|interest)$|(Amount|Balance|Price|Fee|Total|Rate|Subtotal|Principal|Interest)$/;

const MONEY_FACTORIES = new Set(['of', 'parse', 'fromMinor']);
const FLOAT_PARSERS = new Set(['parseFloat', 'Number']);

function includesNumber(typeNode) {
  if (!typeNode) return false;
  if (typeNode.type === 'TSNumberKeyword') return true;
  if (typeNode.type === 'TSUnionType' || typeNode.type === 'TSIntersectionType')
    return typeNode.types.some(includesNumber);
  if (typeNode.type === 'TSArrayType') return includesNumber(typeNode.elementType);
  return false;
}

/** Nombre "monetario" de una expresión: identificador o último miembro (`dto.fee` → `fee`). */
function moneyName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return MONEY_NAME.test(node.name) ? node.name : null;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier')
    return MONEY_NAME.test(node.property.name) ? node.property.name : null;
  if (node.type === 'ChainExpression') return moneyName(node.expression);
  return null;
}

function isNumericLiteral(node) {
  if (!node) return false;
  if (node.type === 'Literal') return typeof node.value === 'number';
  return node.type === 'UnaryExpression' && isNumericLiteral(node.argument);
}

/** @type {import('eslint').Rule.RuleModule} */
export const noNumberMoney = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Los montos y tasas son Money, MoneyDecimal o strings decimales; nunca number (ADR-0006).',
    },
    messages: {
      numberField:
        '"{{name}}" parece dinero o tasa pero su tipo incluye number. Usa Money, MoneyDecimal o un string decimal (ADR-0006).',
      floatParse:
        '"{{name}}" parece dinero: no lo conviertas a number con {{fn}} (INV-001). Usa Money.parse con el string decimal.',
      numericLiteral: 'Money.{{fn}} recibe un string decimal, no un literal number (ADR-0006).',
      numberMethod:
        '"{{name}}.{{fn}}()" convierte o redondea con aritmética binaria (INV-001). Usa los métodos de Money.',
    },
    schema: [],
  },
  create(context) {
    function check(node, name, typeNode) {
      if (name && MONEY_NAME.test(name) && includesNumber(typeNode))
        context.report({ node, messageId: 'numberField', data: { name } });
    }
    function checkParam(param) {
      let p = param.type === 'TSParameterProperty' ? param.parameter : param;
      if (p.type === 'AssignmentPattern') p = p.left;
      if (p.type === 'Identifier') check(p, p.name, p.typeAnnotation?.typeAnnotation);
    }
    return {
      TSPropertySignature(node) {
        if (node.key.type === 'Identifier') check(node, node.key.name, node.typeAnnotation?.typeAnnotation);
      },
      PropertyDefinition(node) {
        if (node.key.type === 'Identifier') check(node, node.key.name, node.typeAnnotation?.typeAnnotation);
      },
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier') check(node, node.id.name, node.id.typeAnnotation?.typeAnnotation);
      },
      'FunctionDeclaration, FunctionExpression, ArrowFunctionExpression, TSMethodSignature, TSDeclareFunction'(
        node,
      ) {
        for (const p of node.params) checkParam(p);
      },
      UnaryExpression(node) {
        const name = node.operator === '+' ? moneyName(node.argument) : null;
        if (name) context.report({ node, messageId: 'floatParse', data: { name, fn: 'unary +' } });
      },
      CallExpression(node) {
        const callee = node.callee;
        // parseFloat(fee) / Number(dto.amount)
        if (callee.type === 'Identifier' && FLOAT_PARSERS.has(callee.name)) {
          const name = moneyName(node.arguments[0]);
          if (name) context.report({ node, messageId: 'floatParse', data: { name, fn: callee.name } });
          return;
        }
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier')
          return;
        const method = callee.property.name;
        // Number.parseFloat(fee)
        if (
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Number' &&
          method === 'parseFloat'
        ) {
          const name = moneyName(node.arguments[0]);
          if (name)
            context.report({ node, messageId: 'floatParse', data: { name, fn: 'Number.parseFloat' } });
          return;
        }
        // Money.of(10.5, 'BOB')
        if (
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Money' &&
          MONEY_FACTORIES.has(method)
        ) {
          if (isNumericLiteral(node.arguments[0]))
            context.report({ node: node.arguments[0], messageId: 'numericLiteral', data: { fn: method } });
          return;
        }
        // total.toFixed(2) (Number#toFixed; Money#toFixed no recibe argumentos) y amount.toNumber()
        const name = moneyName(callee.object);
        if (!name) return;
        if ((method === 'toFixed' && node.arguments.length > 0) || method === 'toNumber')
          context.report({ node, messageId: 'numberMethod', data: { name, fn: method } });
      },
    };
  },
};
