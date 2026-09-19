import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import '../theme/app_theme.dart';

/// Redesigned animated Truxify logo for driver onboarding and splash screens (#311).
class TruxifyLogo extends StatelessWidget {
  const TruxifyLogo({
    super.key,
    this.size = 28,
    this.textColor,
    this.animate = true,
  });

  final double size;
  final Color? textColor;
  final bool animate;

  @override
  Widget build(BuildContext context) {
    final color = textColor ?? Theme.of(context).colorScheme.onSurface;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size * 1.15,
          height: size * 1.15,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [TruxifyColors.accent, TruxifyColors.accentDark],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(size * 0.28),
            boxShadow: [
              BoxShadow(
                color: TruxifyColors.accent.withValues(alpha: 0.06),
                blurRadius: 8,
                offset: const Offset(0, 2),
              )
            ],
          ),
          child: Center(
            child: animate
                ? Lottie.asset(
                    'assets/animations/truxify_logo_anim.json',
                    width: size * 0.62,
                    height: size * 0.62,
                    fit: BoxFit.contain,
                    errorBuilder: (context, error, stackTrace) {
                      return Icon(
                        Icons.local_shipping_rounded,
                        size: size * 0.62,
                        color: TruxifyColors.white,
                      );
                    },
                  )
                : Icon(
                    Icons.local_shipping_rounded,
                    size: size * 0.62,
                    color: TruxifyColors.white,
                  ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'Truxify',
          style: TextStyle(
            color: color,
            fontSize: size - 2,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.4,
          ),
        ),
      ],
    );
  }
}