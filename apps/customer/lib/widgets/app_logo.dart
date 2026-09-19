import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';

/// Redesigned animated Truxify logo for onboarding and splash screens (#311).
class AppLogo extends StatelessWidget {
  const AppLogo({
    super.key,
    this.centered = false,
    this.size = 100.0,
    this.textStyle,
    this.animate = true,
    this.iconSize = 22,
  });

  final bool centered;
  final double size;
  final TextStyle? textStyle;
  final bool animate;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    final logo = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: iconSize + 10,
          height: iconSize + 10,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(12),
          ),
          child: animate
              ? Lottie.asset(
                  'assets/animations/truxify_logo_anim.json',
                  width: iconSize + 10,
                  height: iconSize + 10,
                  fit: BoxFit.contain,
                  errorBuilder: (context, error, stackTrace) {
                    return Icon(
                      Icons.local_shipping_rounded,
                      color: Theme.of(context).colorScheme.primary,
                      size: iconSize,
                    );
                  },
                )
              : Icon(
                  Icons.local_shipping_rounded,
                  color: Theme.of(context).colorScheme.primary,
                  size: iconSize,
                ),
        ),
        const SizedBox(width: 10),
        Text(
          'Truxify',
          style: textStyle ??
              const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
              ),
        ),
      ],
    );

    if (!centered) return logo;
    return Center(child: logo);
  }
}