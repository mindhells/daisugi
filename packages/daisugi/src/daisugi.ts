import {
  result,
  ResultFail,
  Code,
} from '@daisugi/kintsugi';

import {
  FailException,
  Handler,
  HandlerDecorator,
  StopPropagationException,
  Toolkit,
} from './types';

export { Handler, Toolkit } from './types';

// duck type validation.
function isFnAsync(handler: Handler) {
  return handler.constructor.name === 'AsyncFunction';
}

export function stopPropagationWith(
  value,
): ResultFail<StopPropagationException> {
  return result.fail({
    code: Code.StopPropagation,
    value,
  });
}

export function failWith(value): ResultFail<FailException> {
  return result.fail({
    code: Code.Fail,
    value,
  });
}

function decorateHandler(
  userHandler: Handler,
  userHandlerDecorators: HandlerDecorator[],
  nextHandler: Handler,
): Handler {
  const isAsync = isFnAsync(userHandler);
  const { injectToolkit } = userHandler.meta || {};
  let toolkit: Partial<Toolkit>;

  // Declare `toolkit` variable.
  if (injectToolkit) {
    toolkit = {
      nextWith(...args) {
        if (nextHandler) {
          return nextHandler(...args);
        }

        return null;
      },
      failWith,
    };
  }

  const decoratedUserHandler = userHandlerDecorators.reduce(
    (currentUserHandler, userHandlerDecorator) => {
      const decoratedHandler = userHandlerDecorator(
        currentUserHandler,
        toolkit as Toolkit,
      );

      decoratedHandler.meta = currentUserHandler.meta;

      return decoratedHandler;
    },
    userHandler,
  );

  // Maybe use of arguments instead.
  function handler(...args) {
    // Duck type condition, maybe use instanceof and result class here.
    if (args[0]?.isFailure) {
      const firstArg = args[0];

      if (firstArg.error.code === Code.Fail) {
        return firstArg;
      }

      if (firstArg.error.code === Code.StopPropagation) {
        return firstArg.error.value;
      }
    }

    if (injectToolkit) {
      // Add runtime `toolkit` properties whose depend of the arguments.
      Object.defineProperty(toolkit, 'next', {
        get() {
          return toolkit.nextWith(...args);
        },
        configurable: true,
      });

      return decoratedUserHandler(...args, toolkit);
    }

    if (!nextHandler) {
      return decoratedUserHandler(...args);
    }

    if (isAsync) {
      return decoratedUserHandler(...args).then(
        nextHandler,
      );
    }

    if (nextHandler.__meta__.isAsync) {
      return Promise.resolve(
        decoratedUserHandler(...args),
      ).then(nextHandler);
    }

    return nextHandler(decoratedUserHandler(...args));
  }

  handler.__meta__ = { isAsync };

  return handler;
}

function createPipeline(
  userHandlerDecorators: HandlerDecorator[],
) {
  return function (userHandlers: Handler[]) {
    return userHandlers.reduceRight(
      (nextHandler, userHandler) => {
        return decorateHandler(
          userHandler,
          userHandlerDecorators,
          nextHandler,
        );
      },
      null,
    );
  };
}

export function daisugi(
  userHandlerDecorators: HandlerDecorator[] = [],
) {
  const pipeline = createPipeline(userHandlerDecorators);

  return {
    sequenceOf: pipeline,
  };
}
